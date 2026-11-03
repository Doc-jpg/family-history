-- Family History: database schema (Postgres / Supabase)
-- Status: WRITTEN, NOT YET APPLIED. Apply in the Supabase SQL editor once the project exists.
-- Design: the admin owns one family document; relatives get server-enforced, scoped reads
-- through row-level security, and may only INSERT contributions. Nothing a relative does
-- can modify the approved record. The admin is the single auth user listed in `admins`.
--
-- First release keeps the whole dataset as one JSON document (family_documents) because the
-- app is already built around one in-memory Dataset and that keeps backup/restore trivial.
-- The relational tables below hold the scoped projection relatives are allowed to read; the
-- `publish_scoped_view()` function rebuilds them from the document on every admin save.

create extension if not exists pgcrypto;

-- Who is the administrator. Exactly one row expected (Deren's auth user id after first sign-in).
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean language sql stable as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- The whole archive as one document. Admin only.
create table if not exists family_documents (
  id text primary key,
  document jsonb not null,
  updated_at timestamptz not null default now()
);
alter table family_documents enable row level security;
create policy "admin reads document" on family_documents for select using (is_admin());
create policy "admin writes document" on family_documents for insert with check (is_admin());
create policy "admin updates document" on family_documents for update using (is_admin()) with check (is_admin());

-- Every version of the document, append-only, for rollback and audit. Admin only.
create table if not exists document_versions (
  id bigserial primary key,
  document jsonb not null,
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  note text
);
alter table document_versions enable row level security;
create policy "admin reads versions" on document_versions for select using (is_admin());
create policy "admin writes versions" on document_versions for insert with check (is_admin());

create or replace function snapshot_document() returns trigger language plpgsql security definer as $$
begin
  insert into document_versions (document, saved_by) values (old.document, auth.uid());
  return new;
end $$;
drop trigger if exists family_documents_snapshot on family_documents;
create trigger family_documents_snapshot before update on family_documents for each row execute function snapshot_document();

-- Invitations. The raw token and code never reach the database; only sha256 hashes.
create table if not exists invitations (
  id text primary key,
  recipient_name text not null,
  person_id text,
  email text,
  role text not null check (role in ('viewer','contributor','editor')),
  scope jsonb not null,                -- {branches:[], personIds:[], includeLivingDetails:bool}
  token_hash text not null unique,
  code_hash text not null,
  status text not null default 'pending' check (status in ('pending','active','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  activated_at timestamptz,
  last_seen_at timestamptz,
  member_user_id uuid references auth.users(id),   -- set when the relative verifies by email (OTP)
  verified_identity text,
  -- Device binding: the first device that enters the code becomes the only contributor device.
  forwarded text not null default 'view' check (forwarded in ('view','view-with-code','refuse')),
  device_hash text,            -- sha256 of that device's id; null until first unlock
  bound_at timestamptz,
  device_label text
);
alter table invitations enable row level security;
create policy "admin manages invitations" on invitations for all using (is_admin()) with check (is_admin());
create policy "member reads own invitation" on invitations for select using (member_user_id = auth.uid());

-- The scoped projection relatives read. Rebuilt from the document by the admin's save.
create table if not exists people_public (
  id text primary key,
  branch text not null,
  living boolean not null,
  privacy text not null,
  placeholder boolean not null default false,
  data jsonb not null,         -- the Person minus admin notes and open questions
  data_living_safe jsonb not null  -- same, with living people's details removed
);
create table if not exists relationships_public (id text primary key, from_id text not null, to_id text not null, data jsonb not null);
create table if not exists events_public (id text primary key, person_ids text[] not null, type text not null, living_sensitive boolean not null default false, data jsonb not null);
create table if not exists places_public (id text primary key, data jsonb not null);
create table if not exists media_public (id text primary key, person_ids text[] not null, privacy text not null, data jsonb not null);
alter table people_public enable row level security;
alter table relationships_public enable row level security;
alter table events_public enable row level security;
alter table places_public enable row level security;
alter table media_public enable row level security;

-- The scope of the signed-in relative, or null.
create or replace function my_scope() returns jsonb language sql stable as $$
  select scope from invitations
  where member_user_id = auth.uid() and status = 'active' and expires_at > now()
  limit 1;
$$;

-- Server-side visibility rule; must match src/model/access.ts isVisible().
create or replace function person_visible(p people_public, scope jsonb) returns boolean language sql stable as $$
  select scope is not null
    and not p.placeholder
    and p.privacy <> 'private'
    and (
      p.branch = 'self'
      or (scope->'personIds') ? p.id
      or (scope->'branches') ? p.branch
      or (p.branch = 'both' and ((scope->'branches') ? 'paternal' or (scope->'branches') ? 'maternal'))
    );
$$;

create policy "admin reads people_public" on people_public for select using (is_admin());
create policy "member reads scoped people" on people_public for select using (person_visible(people_public, my_scope()));
create policy "admin writes people_public" on people_public for all using (is_admin()) with check (is_admin());

create policy "member reads scoped relationships" on relationships_public for select using (
  is_admin() or (
    exists (select 1 from people_public a where a.id = from_id and person_visible(a, my_scope()))
    and exists (select 1 from people_public b where b.id = to_id and person_visible(b, my_scope()))
  ));
create policy "admin writes relationships_public" on relationships_public for all using (is_admin()) with check (is_admin());

create policy "member reads scoped events" on events_public for select using (
  is_admin() or (
    exists (select 1 from people_public p where p.id = any(person_ids) and person_visible(p, my_scope()))
    and (not living_sensitive or coalesce((my_scope()->>'includeLivingDetails')::boolean, false))
  ));
create policy "admin writes events_public" on events_public for all using (is_admin()) with check (is_admin());

create policy "member reads places" on places_public for select using (is_admin() or my_scope() is not null);
create policy "admin writes places_public" on places_public for all using (is_admin()) with check (is_admin());

create policy "member reads scoped media" on media_public for select using (
  is_admin() or (privacy <> 'private' and exists (select 1 from people_public p where p.id = any(person_ids) and person_visible(p, my_scope()))));
create policy "admin writes media_public" on media_public for all using (is_admin()) with check (is_admin());

-- Contributions: relatives INSERT only, read their own; admin reads and reviews everything.
create table if not exists contributions (
  id text primary key,
  invitation_id text not null references invitations(id),
  submitted_by uuid references auth.users(id),
  contributor_name text not null,
  contributor_identity text,
  submitted_at timestamptz not null default now(),
  kind text not null,
  subject jsonb not null,
  proposal text not null,
  fields jsonb,
  reasoning text,
  attachment_paths text[] not null default '{}',
  status text not null default 'new' check (status in ('new','approved','research','clarify','partial','rejected','disputed')),
  review_notes text,
  history jsonb not null default '[]'
);
alter table contributions enable row level security;
create policy "member submits" on contributions for insert with check (
  submitted_by = auth.uid()
  and exists (select 1 from invitations i where i.id = invitation_id and i.member_user_id = auth.uid() and i.status = 'active' and i.expires_at > now() and i.role in ('contributor','editor'))
);
create policy "member reads own" on contributions for select using (submitted_by = auth.uid());
create policy "admin reviews" on contributions for all using (is_admin()) with check (is_admin());

-- Server stamps who submitted; the client cannot forge contributor identity.
create or replace function stamp_contribution() returns trigger language plpgsql security definer as $$
declare inv invitations%rowtype;
begin
  select * into inv from invitations where id = new.invitation_id;
  new.submitted_by := auth.uid();
  new.contributor_name := inv.recipient_name;
  new.contributor_identity := inv.verified_identity;
  new.submitted_at := now();
  new.status := 'new';
  new.history := jsonb_build_array(jsonb_build_object('at', now(), 'by', inv.recipient_name, 'action', 'submitted'));
  update invitations set last_seen_at = now() where id = inv.id;
  return new;
end $$;
drop trigger if exists contributions_stamp on contributions;
create trigger contributions_stamp before insert on contributions for each row execute function stamp_contribution();

-- Access requests: anyone who opened a forwarded, dead or someone else's link and asked for
-- their own. Inserted through the `request-access` edge function (rate-limited, no sign-in
-- needed); admin reads, grants (creates a new invitation) or declines.
create table if not exists access_requests (
  id text primary key,
  name text not null,
  relationship text not null,
  email text,
  phone text,
  message text,
  via_invitation_id text references invitations(id),
  device_hash text,
  submitted_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','granted','declined')),
  granted_invitation_id text references invitations(id),
  review_note text
);
alter table access_requests enable row level security;
create policy "admin manages access requests" on access_requests for all using (is_admin()) with check (is_admin());

-- Audit log: append-only, admin reads.
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users(id),
  actor_label text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);
alter table audit_log enable row level security;
create policy "admin reads audit" on audit_log for select using (is_admin());
create policy "anyone signed in appends audit" on audit_log for insert with check (auth.uid() is not null and actor = auth.uid());

-- Storage: one private bucket "family-media". Objects are readable by the admin, and by a
-- member only when a media_public row they can see references the object path.
insert into storage.buckets (id, name, public) values ('family-media', 'family-media', false) on conflict do nothing;
create policy "admin all media" on storage.objects for all using (bucket_id = 'family-media' and is_admin()) with check (bucket_id = 'family-media' and is_admin());
create policy "member uploads to contributions folder" on storage.objects for insert with check (bucket_id = 'family-media' and my_scope() is not null and (storage.foldername(name))[1] = 'contributions');
create policy "member reads scoped media objects" on storage.objects for select using (
  bucket_id = 'family-media' and exists (select 1 from media_public m where m.data->>'storagePath' = name and (m.privacy <> 'private') and exists (select 1 from people_public p where p.id = any(m.person_ids) and person_visible(p, my_scope()))));

-- Rebuild the scoped projection from the document. Called by the admin after each save.
create or replace function publish_scoped_view() returns void language plpgsql security definer as $$
declare doc jsonb;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select document into doc from family_documents where id = 'main';
  delete from people_public; delete from relationships_public; delete from events_public; delete from places_public; delete from media_public;
  insert into people_public (id, branch, living, privacy, placeholder, data, data_living_safe)
    select p->>'id', p->>'branch', (p->>'living') <> 'no', p->>'privacy', coalesce((p->>'placeholder')::boolean, false),
           p - 'notes' - 'openQuestions', (p - 'notes' - 'openQuestions')
    from jsonb_array_elements(doc->'people') p;
  insert into relationships_public (id, from_id, to_id, data) select r->>'id', r->>'fromId', r->>'toId', r from jsonb_array_elements(doc->'relationships') r;
  insert into events_public (id, person_ids, type, living_sensitive, data)
    select e->>'id', array(select jsonb_array_elements_text(e->'personIds')), e->>'type',
           (e->>'type') in ('birth','residence','census') and exists (
             select 1 from jsonb_array_elements(doc->'people') p where (p->>'id') in (select jsonb_array_elements_text(e->'personIds')) and (p->>'living') <> 'no'),
           e
    from jsonb_array_elements(doc->'events') e;
  insert into places_public (id, data) select pl->>'id', pl from jsonb_array_elements(doc->'places') pl;
  insert into media_public (id, person_ids, privacy, data) select m->>'id', array(select jsonb_array_elements_text(m->'personIds')), m->>'privacy', m from jsonb_array_elements(doc->'media') m;
end $$;

-- Keep-alive table for the GitHub Actions ping (free projects pause after a week idle).
create table if not exists keepalive (id int primary key default 1, pinged_at timestamptz not null default now());
alter table keepalive enable row level security;
create policy "anyone reads keepalive" on keepalive for select using (true);
insert into keepalive (id) values (1) on conflict do nothing;
