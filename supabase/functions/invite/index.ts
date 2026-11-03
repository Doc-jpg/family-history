// Edge function `invite`: everything a relative's browser may do, run on the server with the
// service key. The browser only ever receives the redacted dataset for the invitation's scope.
// Built into one file by `npm run bundle:functions` so it can be pasted into the Supabase
// dashboard (Edge Functions > Deploy via editor) or deployed with the CLI.
//
// Actions (POST JSON): probe, open, submit, request-access, upload-url, media-url.
// The invitation token (from the link) plus a stable per-browser device id are the credential;
// the 6-digit code is needed once to bind the first device (same rules as src/model/access.ts).

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Contribution, Dataset, Media } from '../../../src/model/types.ts';
import { bindDevice, probeInvitation, publicInvitation, redact, redeemInvitation, sessionStillValid, sha256Hex, submitAccessRequest } from '../../../src/model/access.ts';
import { audit, submitContribution } from '../../../src/model/review.ts';
import { applyAttestation, countWrongCode } from '../../../src/model/invite-api.ts';
import { newId } from '../../../src/model/graph.ts';

const BUCKET = 'family-media';
const MAX_UPLOAD = 200 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function readDoc(): Promise<{ doc: Dataset; updatedAt: string } | null> {
  const { data } = await admin.from('family_documents').select('document, updated_at').eq('id', 'main').maybeSingle();
  return data ? { doc: data.document as Dataset, updatedAt: data.updated_at as string } : null;
}

/** Read-modify-write with an optimistic check on updated_at; retried a few times. */
async function mutate(fn: (doc: Dataset) => Promise<Dataset | null>): Promise<Dataset | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readDoc();
    if (!cur) return null;
    const next = await fn(cur.doc);
    if (!next) return null;
    const { data } = await admin.from('family_documents').update({ document: next, updated_at: new Date().toISOString() }).eq('id', 'main').eq('updated_at', cur.updatedAt).select('id');
    if (data && data.length) return next;
  }
  throw new Error('document busy');
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: false, reason: 'bad-json' }, 400); }
  const { action, token, deviceId } = body;
  if (typeof token !== 'string' || typeof deviceId !== 'string' || !token || !deviceId) return json({ ok: false, reason: 'missing' }, 400);
  const cur = await readDoc();
  if (!cur) return json({ ok: false, reason: 'no-document' }, 503);
  const doc = cur.doc;

  try {
    switch (action) {
      case 'probe': {
        const pr = await probeInvitation(doc, token, deviceId);
        return json('invitation' in pr ? { ...pr, invitation: publicInvitation(pr.invitation) } : pr);
      }
      case 'open': {
        const { code = '', deviceLabel = 'device', restore } = body;
        if (restore === 'full' || restore === 'view') {
          const pr = await probeInvitation(doc, token, deviceId);
          if ('invitation' in pr && (await sessionStillValid(doc, pr.invitation.id, deviceId, restore))) {
            return json({ ok: true, mode: restore, invitation: publicInvitation(pr.invitation), scoped: redact(doc, pr.invitation.scope) });
          }
          return json({ ok: false, reason: 'not-found' });
        }
        const r = await redeemInvitation(doc, token, String(code), deviceId);
        if (!r.ok) {
          if (r.reason === 'bad-code') await mutate((d) => countWrongCode(d, token));
          return json(r);
        }
        const now = new Date().toISOString();
        if (r.mode === 'full') {
          const next = await mutate(async (d) => {
            let n = audit(d, { actor: r.invitation.recipientName, action: r.firstDevice ? 'invitation-opened-and-bound' : 'invitation-opened', entity: 'invitation', entityId: r.invitation.id, after: r.firstDevice ? { device: deviceLabel } : undefined });
            n = { ...n, invitations: n.invitations.map((i) => (i.id === r.invitation.id ? { ...i, status: 'active', activatedAt: i.activatedAt ?? now, lastSeenAt: now, codeAttempts: 0 } : i)) };
            if (r.firstDevice) n = await bindDevice(n, r.invitation.id, deviceId, deviceLabel);
            return n;
          });
          const inv = next!.invitations.find((i) => i.id === r.invitation.id)!;
          return json({ ok: true, mode: 'full', invitation: publicInvitation(inv), scoped: redact(next!, inv.scope), firstDevice: r.firstDevice });
        }
        if (String(code).trim()) await mutate(async (d) => audit(d, { actor: 'view-only visitor', action: 'forwarded-link-viewed', entity: 'invitation', entityId: r.invitation.id, after: { device: deviceLabel } }));
        return json({ ok: true, mode: 'view', invitation: publicInvitation(r.invitation), scoped: redact(doc, r.invitation.scope) });
      }
      case 'submit': {
        const pr = await probeInvitation(doc, token, deviceId);
        if (!('invitation' in pr) || pr.state !== 'mine' || pr.invitation.role === 'viewer') return json({ ok: false, reason: 'not-allowed' }, 403);
        const inv = pr.invitation;
        const c = body.contribution as Contribution;
        const media = (Array.isArray(body.media) ? body.media : []) as Media[];
        if (!c || typeof c.proposal !== 'string') return json({ ok: false, reason: 'bad-contribution' }, 400);
        const prefix = `contributions/${inv.id}/`;
        // Media records may only point at this invitation's own uploads.
        const safeMedia = media.filter((m) => typeof m.storagePath === 'string' && m.storagePath.startsWith(prefix)).map((m) => ({ ...m, privacy: 'family' as const }));
        const input = { ...c, invitationId: inv.id, contributorName: inv.recipientName, contributorIdentity: inv.verifiedIdentity, attachmentMediaIds: safeMedia.map((m) => m.id) };
        await mutate(async (d) => ({ ...submitContribution(d, input).ds, media: [...d.media, ...safeMedia], invitations: d.invitations.map((i) => (i.id === inv.id ? { ...i, lastSeenAt: new Date().toISOString() } : i)) }));
        return json({ ok: true });
      }
      case 'request-access': {
        const pr = await probeInvitation(doc, token, deviceId);
        const r = body.request as Record<string, string | undefined>;
        if (!r || !r.name || !r.relationship) return json({ ok: false, reason: 'bad-request' }, 400);
        const deviceHash = await sha256Hex(deviceId);
        const clean = { name: String(r.name).slice(0, 120), relationship: String(r.relationship).slice(0, 200), email: r.email ? String(r.email).slice(0, 200) : undefined, phone: r.phone ? String(r.phone).slice(0, 40) : undefined, message: r.message ? String(r.message).slice(0, 2000) : undefined, personId: r.personId && doc.people.some((p) => p.id === r.personId) ? String(r.personId) : undefined };
        await mutate(async (d) => submitAccessRequest(d, { ...clean, viaInvitationId: 'invitation' in pr ? pr.invitation.id : undefined, deviceHash }).ds);
        return json({ ok: true });
      }
      case 'upload-url': {
        const pr = await probeInvitation(doc, token, deviceId);
        if (!('invitation' in pr) || pr.state !== 'mine' || pr.invitation.role === 'viewer') return json({ ok: false, reason: 'not-allowed' }, 403);
        const size = Number(body.size) || 0;
        if (size > MAX_UPLOAD) return json({ ok: false, reason: 'too-large' }, 413);
        const id = newId('m');
        const safeName = String(body.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80);
        const path = `contributions/${pr.invitation.id}/${id}-${safeName}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error || !data) return json({ ok: false, reason: error?.message || 'storage' }, 500);
        return json({ ok: true, id, path, signedToken: data.token });
      }
      case 'media-url': {
        const pr = await probeInvitation(doc, token, deviceId);
        if (!('invitation' in pr)) return json({ ok: false, reason: 'not-allowed' }, 403);
        const scoped = redact(doc, pr.invitation.scope);
        const m = scoped.media.find((x) => x.id === body.mediaId);
        if (!m || !m.storagePath) return json({ ok: false, reason: 'not-visible' }, 404);
        const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(m.storagePath, 60 * 60);
        if (error || !data) return json({ ok: false, reason: 'storage' }, 500);
        return json({ ok: true, url: data.signedUrl });
      }
      case 'attest': {
        const pr = await probeInvitation(doc, token, deviceId);
        if (!('invitation' in pr) || pr.state !== 'mine' || pr.invitation.role === 'viewer') return json({ ok: false, reason: 'not-allowed' }, 403);
        const stance = body.stance === 'dispute' ? 'dispute' : body.stance === 'confirm' ? 'confirm' : null;
        if (!stance || typeof body.personId !== 'string') return json({ ok: false, reason: 'bad-request' }, 400);
        const inv = pr.invitation;
        const note = body.note ? String(body.note).slice(0, 2000) : undefined;
        const field = body.field ? String(body.field).slice(0, 40) : undefined;
        await mutate(async (d) => applyAttestation(d, inv, String(body.personId), stance, note, field));
        return json({ ok: true });
      }
      default:
        return json({ ok: false, reason: 'unknown-action' }, 400);
    }
  } catch (e) {
    return json({ ok: false, reason: (e as Error).message }, 500);
  }
});
