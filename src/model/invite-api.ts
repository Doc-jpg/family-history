import type { AccessRequest, Contribution, Dataset, Invitation, Media } from './types';
import { bindDevice, probeInvitation, publicInvitation, redact, redeemInvitation, sessionStillValid, sha256Hex, submitAccessRequest, type ProbeResult, type RedeemResult } from './access';
import { audit, submitContribution } from './review';
import { attest } from './standing';
import { newId } from './graph';

// Everything a relative's browser may do, behind one interface.
// Local mode: runs against the dataset in this browser (a demonstration on the admin's machine).
// Cloud mode: every call goes to the `invite` edge function, which holds the service key and
// applies the same pure functions to the real document. The relative's browser never sees
// more than the redacted dataset for their scope.

export type OpenResult =
  | { ok: true; mode: 'full' | 'view'; invitation: Invitation; scoped: Dataset; firstDevice?: boolean }
  | { ok: false; reason: Extract<RedeemResult, { ok: false }>['reason'] };

export interface UploadedFile { id: string; name: string; kind: Media['kind']; size: number; storagePath: string }

export type ContributionInput = Omit<Contribution, 'id' | 'submittedAt' | 'status' | 'history'>;
export type AccessRequestInput = Omit<AccessRequest, 'id' | 'submittedAt' | 'status'>;

export interface InviteApi {
  probe(token: string, deviceId: string): Promise<ProbeResult>;
  /** Open a link with (or without) a code. Also used to restore a session: pass the remembered mode and no code. */
  open(token: string, code: string, deviceId: string, deviceLabel: string, restore?: 'full' | 'view'): Promise<OpenResult>;
  submit(token: string, deviceId: string, c: ContributionInput, media: Media[]): Promise<{ ok: boolean }>;
  requestAccess(token: string, deviceId: string, r: Omit<AccessRequestInput, 'deviceHash' | 'viaInvitationId'>): Promise<{ ok: boolean }>;
  upload(token: string, deviceId: string, file: Blob, name: string, kind: Media['kind']): Promise<UploadedFile>;
  /** A URL the browser can load for a media record the relative is allowed to see. */
  mediaUrl(token: string, deviceId: string, m: Media): Promise<string | null>;
  /** Pencil and pen: "looks right" or "something's off" about a person's record. A dispute also lands in the admin's inbox. */
  attest(token: string, deviceId: string, personId: string, stance: 'confirm' | 'dispute', note?: string, field?: string): Promise<{ ok: boolean }>;
}

/** Shared by local mode and the edge function: record the stance and, for a dispute, a contribution for the inbox. */
export function applyAttestation(ds: Dataset, inv: Invitation, personId: string, stance: 'confirm' | 'dispute', note?: string, field?: string): Dataset {
  const person = ds.people.find((p) => p.id === personId);
  if (!person || person.placeholder) return ds;
  let next = attest(ds, { personId, by: inv.id, byName: inv.recipientName, stance, note, field });
  next = audit(next, { actor: inv.recipientName, action: stance === 'confirm' ? 'confirmed' : 'disputed', entity: 'person', entityId: personId, after: note });
  if (stance === 'dispute') {
    next = submitContribution(next, { invitationId: inv.id, contributorName: inv.recipientName, contributorIdentity: inv.verifiedIdentity, kind: 'dispute', subject: { type: 'person', id: personId, label: `${person.givenNames} ${person.surname}`.trim() }, proposal: note || 'Something here is wrong (no details given).', fields: field ? { field } : {}, attachmentMediaIds: [] }).ds;
  }
  return next;
}

/** One more wrong code against the invitation behind this token. Shared by local mode and the edge function. */
export async function countWrongCode(ds: Dataset, rawToken: string): Promise<Dataset> {
  const h = await sha256Hex(rawToken);
  return { ...ds, invitations: ds.invitations.map((i) => (i.tokenHash === h ? { ...i, codeAttempts: (i.codeAttempts ?? 0) + 1 } : i)) };
}

/** Local mode: the dataset lives in this browser's store. */
export function localInviteApi(get: () => Dataset, update: (fn: (d: Dataset) => Dataset) => void, putFile: (id: string, b: Blob) => Promise<void>, getFile: (id: string) => Promise<Blob | undefined>): InviteApi {
  return {
    probe: (token, deviceId) => probeInvitation(get(), token, deviceId),
    async open(token, code, deviceId, deviceLabel, restore) {
      const ds = get();
      if (restore) {
        const pr = await probeInvitation(ds, token, deviceId);
        if ('invitation' in pr && (await sessionStillValid(ds, pr.invitation.id, deviceId, restore))) {
          return { ok: true, mode: restore, invitation: publicInvitation(pr.invitation), scoped: redact(ds, pr.invitation.scope) };
        }
        return { ok: false, reason: 'not-found' };
      }
      const r = await redeemInvitation(ds, token, code, deviceId);
      if (!r.ok) {
        if (r.reason === 'bad-code') { const counted = await countWrongCode(ds, token); update(() => counted); }
        return r;
      }
      const now = new Date().toISOString();
      if (r.mode === 'full') {
        let next = audit(ds, { actor: r.invitation.recipientName, action: r.firstDevice ? 'invitation-opened-and-bound' : 'invitation-opened', entity: 'invitation', entityId: r.invitation.id, after: r.firstDevice ? { device: deviceLabel } : undefined });
        next = { ...next, invitations: next.invitations.map((i) => (i.id === r.invitation.id ? { ...i, status: 'active', activatedAt: i.activatedAt ?? now, lastSeenAt: now, codeAttempts: 0 } : i)) };
        if (r.firstDevice) next = await bindDevice(next, r.invitation.id, deviceId, deviceLabel);
        update(() => next);
        const inv = next.invitations.find((i) => i.id === r.invitation.id)!;
        return { ok: true, mode: 'full', invitation: publicInvitation(inv), scoped: redact(next, inv.scope), firstDevice: r.firstDevice };
      }
      if (code.trim()) update((d) => audit(d, { actor: 'view-only visitor', action: 'forwarded-link-viewed', entity: 'invitation', entityId: r.invitation.id, after: { device: deviceLabel } }));
      return { ok: true, mode: 'view', invitation: publicInvitation(r.invitation), scoped: redact(ds, r.invitation.scope) };
    },
    async submit(token, deviceId, c, media) {
      const ds = get();
      const pr = await probeInvitation(ds, token, deviceId);
      if (!('invitation' in pr) || pr.state !== 'mine') return { ok: false };
      update((d) => ({ ...submitContribution(d, c).ds, media: [...d.media, ...media] }));
      return { ok: true };
    },
    async requestAccess(token, deviceId, r) {
      const ds = get();
      const pr = await probeInvitation(ds, token, deviceId);
      const deviceHash = await sha256Hex(deviceId);
      update((d) => submitAccessRequest(d, { ...r, viaInvitationId: 'invitation' in pr ? pr.invitation.id : undefined, deviceHash }).ds);
      return { ok: true };
    },
    async upload(_token, _deviceId, file, name, kind) {
      const id = newId('m');
      await putFile(id, file);
      return { id, name, kind, size: file.size, storagePath: `local:${id}` };
    },
    async mediaUrl(_token, _deviceId, m) {
      if (m.dataUrl) return m.dataUrl;
      if (m.storagePath?.startsWith('local:')) {
        const b = await getFile(m.storagePath.slice(6));
        return b ? URL.createObjectURL(b) : null;
      }
      return null;
    },
    async attest(token, deviceId, personId, stance, note, field) {
      const ds = get();
      const pr = await probeInvitation(ds, token, deviceId);
      if (!('invitation' in pr) || pr.state !== 'mine' || pr.invitation.role === 'viewer') return { ok: false };
      update((d) => applyAttestation(d, pr.invitation, personId, stance, note, field));
      return { ok: true };
    },
  };
}

/** Cloud mode: the edge function does the work. `call` posts JSON to it; `uploadSigned` PUTs a file to a signed Storage URL. */
export function cloudInviteApi(call: (body: Record<string, unknown>) => Promise<Record<string, unknown>>, uploadSigned: (path: string, signedToken: string, file: Blob) => Promise<void>): InviteApi {
  return {
    probe: (token, deviceId) => call({ action: 'probe', token, deviceId }) as Promise<ProbeResult>,
    open: (token, code, deviceId, deviceLabel, restore) => call({ action: 'open', token, code, deviceId, deviceLabel, restore }) as Promise<OpenResult>,
    submit: (token, deviceId, contribution, media) => call({ action: 'submit', token, deviceId, contribution, media }) as Promise<{ ok: boolean }>,
    requestAccess: (token, deviceId, request) => call({ action: 'request-access', token, deviceId, request }) as Promise<{ ok: boolean }>,
    async upload(token, deviceId, file, name, kind) {
      const r = (await call({ action: 'upload-url', token, deviceId, name, kind, size: file.size, contentType: (file as File).type || 'application/octet-stream' })) as { ok: boolean; id: string; path: string; signedToken: string; reason?: string };
      if (!r.ok) throw new Error(r.reason || 'upload refused');
      await uploadSigned(r.path, r.signedToken, file);
      return { id: r.id, name, kind, size: file.size, storagePath: r.path };
    },
    async mediaUrl(token, deviceId, m) {
      if (m.dataUrl) return m.dataUrl;
      if (!m.storagePath || m.storagePath.startsWith('local:')) return null;
      const r = (await call({ action: 'media-url', token, deviceId, mediaId: m.id })) as { ok: boolean; url?: string };
      return r.ok && r.url ? r.url : null;
    },
    attest: (token, deviceId, personId, stance, note, field) => call({ action: 'attest', token, deviceId, personId, stance, note, field }) as Promise<{ ok: boolean }>,
  };
}
