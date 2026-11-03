-- Family History: database schema (Postgres / Supabase). Apply in the SQL editor; safe to re-run.
--
-- Design: the administrator owns one family document (family_documents, id 'main') and is the
-- only authenticated user the database knows. Relatives never touch the database directly:
-- their browser calls the `invite` edge function, which holds the service key, applies the
-- invitation rules (token in the link, 6-digit code given separately, one contributor device
-- per link) and returns only the redacted dataset for their scope. Their submissions are
-- appended to the document by the function; the admin reviews them in the app.
-- Every update of the document is snapshotted into document_versions for rollback.

create extension if not exists pgcrypto;

-- Who is the administrator. One row expected: the owner's auth user id after first sign-in.
--   insert into admins (user_id) select id from auth.users where email = 'owner@example.com';
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
drop policy if exists "admin sees admins" on admins;
create policy "admin sees admins" on admins for select using (user_id = auth.uid());

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- The whole archive as one document. Admin only (the edge function uses the service key, which bypasses RLS).
create table if not exists family_documents (
  id text primary key,
  document jsonb not null,
  updated_at timestamptz not null default now()
);
alter table family_documents enable row level security;
drop policy if exists "admin reads document" on family_documents;
drop policy if exists "admin writes document" on family_documents;
drop policy if exists "admin updates document" on family_documents;
create policy "admin reads document" on family_documents for select using (is_admin());
create policy "admin writes document" on family_documents for insert with check (is_admin());
create policy "admin updates document" on family_documents for update using (is_admin()) with check (is_admin());

-- Every previous version of the document, append-only, for rollback and audit. Admin reads.
create table if not exists document_versions (
  id bigserial primary key,
  document jsonb not null,
  saved_by uuid,
  saved_at timestamptz not null default now(),
  note text
);
alter table document_versions enable row level security;
drop policy if exists "admin reads versions" on document_versions;
create policy "admin reads versions" on document_versions for select using (is_admin());

create or replace function snapshot_document() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into document_versions (document, saved_by) values (old.document, auth.uid());
  return new;
end $$;
drop trigger if exists family_documents_snapshot on family_documents;
create trigger family_documents_snapshot before update on family_documents for each row execute function snapshot_document();

-- Keep the version table from growing without bound: keep the last 200 snapshots.
create or replace function trim_document_versions() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from document_versions where id < (select id from document_versions order by id desc offset 200 limit 1);
  return null;
end $$;
drop trigger if exists document_versions_trim on document_versions;
create trigger document_versions_trim after insert on document_versions for each statement execute function trim_document_versions();

-- Storage: one private bucket "family-media". The admin reads and writes everything; relatives
-- upload through signed upload URLs and read through signed download URLs, both minted by the
-- edge function after it has checked the invitation. No anonymous access at all.
insert into storage.buckets (id, name, public, file_size_limit) values ('family-media', 'family-media', false, 209715200) on conflict (id) do update set public = false, file_size_limit = 209715200;
drop policy if exists "admin all media" on storage.objects;
create policy "admin all media" on storage.objects for all using (bucket_id = 'family-media' and is_admin()) with check (bucket_id = 'family-media' and is_admin());

-- Keep-alive table for the GitHub Actions ping (free projects pause after a week idle).
create table if not exists keepalive (id int primary key default 1, pinged_at timestamptz not null default now());
alter table keepalive enable row level security;
drop policy if exists "anyone reads keepalive" on keepalive;
create policy "anyone reads keepalive" on keepalive for select using (true);
insert into keepalive (id) values (1) on conflict do nothing;
