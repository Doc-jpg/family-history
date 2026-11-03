import type { AccessRequest, AccessScope, Dataset, Invitation, Person, Role } from './types';
import { ancestorDistances, childrenOf, newId, parentsOf, partnersOf } from './graph';

// Scoping rules (also enforced server-side in supabase/schema.sql):
// - A person is visible if their branch is in the scope, or they are listed explicitly,
//   or they are the root person. Placeholders are never visible to invitees.
// - Living people are shown with names and relationships only unless
//   includeLivingDetails is set; birth dates/places and residences are withheld.
// - Private-privacy people are never visible to invitees.

export function visiblePeople(ds: Dataset, scope: AccessScope): Person[] {
  return ds.people.filter((p) => isVisible(ds, p, scope));
}

export function isVisible(ds: Dataset, p: Person, scope: AccessScope): boolean {
  if (p.placeholder) return false;
  if (p.privacy === 'private') return false;
  if (p.id === ds.settings.rootPersonId) return true;
  if (scope.personIds.includes(p.id)) return true;
  if (scope.branches.includes(p.branch)) return true;
  if (p.branch === 'both' && (scope.branches.includes('paternal') || scope.branches.includes('maternal'))) return true;
  if (p.branch === 'inlaw' && scope.branches.includes('household')) return true;
  return false;
}

/** Produce the dataset a given invitation is allowed to see. Pure function, used by UI and tests. */
export function redact(ds: Dataset, scope: AccessScope): Dataset {
  const people = visiblePeople(ds, scope);
  const ids = new Set(people.map((p) => p.id));
  const withholdDetails = (p: Person) => p.living !== 'no' && !scope.includeLivingDetails;
  const events = ds.events.filter((e) => e.personIds.some((id) => ids.has(id))).filter((e) => {
    if (e.type === 'death' || e.type === 'burial') return true;
    const subjects = e.personIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
    if (subjects.length && subjects.every(withholdDetails) && ['birth', 'residence', 'census'].includes(e.type)) return false;
    return true;
  }).map((e) => ({ ...e, personIds: e.personIds.filter((id) => ids.has(id)) }));
  const placeIds = new Set(events.map((e) => e.placeId).filter(Boolean));
  const recordedFor = (p: Person): NonNullable<Person['recorded']> => {
    const ev = ds.events.filter((e) => e.personIds.includes(p.id));
    const out: NonNullable<Person['recorded']> = [];
    if (ds.relationships.filter((r) => r.type === 'parent-child' && r.toId === p.id).map((r) => ds.people.find((x) => x.id === r.fromId)).filter((x) => x && !x.placeholder).length >= 2) out.push('parents');
    const birth = ev.find((e) => e.type === 'birth');
    if (birth && birth.date?.year) out.push('birth');
    if (ev.some((e) => e.type === 'death')) out.push('death');
    if (ev.some((e) => e.type === 'residence')) out.push('residence');
    if (ev.some((e) => e.type === 'occupation')) out.push('occupation');
    if (ds.media.some((m) => m.kind === 'photo' && m.personIds.includes(p.id))) out.push('photo');
    if (p.bio) out.push('bio');
    if (p.maidenName) out.push('maidenName');
    return out;
  };
  return {
    ...ds,
    people: people.map((p) => ({ ...p, notes: undefined, openQuestions: undefined, recorded: recordedFor(p) })),
    relationships: ds.relationships.filter((r) => ids.has(r.fromId) && ids.has(r.toId)),
    events,
    places: ds.places.filter((pl) => placeIds.has(pl.id)),
    media: ds.media.filter((m) => m.privacy !== 'private' && m.personIds.some((id) => ids.has(id))),
    sources: ds.sources,
    attestations: (ds.attestations ?? []).filter((a) => ids.has(a.personId)),
    questions: [],
    invitations: [],
    contributions: [],
    audit: [],
  };
}

export const ROLE_CAN: Record<Role, { view: boolean; contribute: boolean; edit: boolean }> = {
  viewer: { view: true, contribute: false, edit: false },
  contributor: { view: true, contribute: true, edit: false },
  editor: { view: true, contribute: true, edit: true },
};

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node without WebCrypto (very old); not expected in practice.
  const mod = 'node:crypto';
  const { createHash } = (await import(/* @vite-ignore */ mod)) as { createHash: (a: string) => { update: (d: Uint8Array) => { digest: (e: string) => string } } };
  return createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1_000_000).padStart(6, '0');
}

export interface CreatedInvitation {
  invitation: Invitation;
  rawToken: string; // goes in the link only
  code: string; // given to the relative separately (text, phone call)
}

export async function createInvitation(input: {
  recipientName: string;
  personId?: string;
  email?: string;
  deliveryNote?: string;
  role: Role;
  scope: AccessScope;
  days?: number;
}): Promise<CreatedInvitation> {
  const rawToken = randomToken();
  const code = randomCode();
  const created = new Date();
  const expires = new Date(created.getTime() + (input.days ?? 30) * 86400000);
  const invitation: Invitation = {
    id: newId('inv'),
    recipientName: input.recipientName,
    personId: input.personId,
    email: input.email,
    deliveryNote: input.deliveryNote,
    role: input.role,
    scope: input.scope,
    tokenHash: await sha256Hex(rawToken),
    codeHash: await sha256Hex(code),
    status: 'pending',
    createdAt: created.toISOString(),
    expiresAt: expires.toISOString(),
  };
  return { invitation, rawToken, code };
}

export type RedeemResult =
  | { ok: true; mode: 'full'; invitation: Invitation; firstDevice: boolean }
  | { ok: true; mode: 'view'; invitation: Invitation }
  | { ok: false; reason: 'not-found' | 'revoked' | 'expired' | 'bad-code' | 'bound-elsewhere' | 'code-required' | 'locked' };

/** Strip the secrets before an invitation record leaves the server or the admin's store. */
export function publicInvitation(i: Invitation): Invitation {
  return { ...i, tokenHash: '', codeHash: '', email: undefined, deliveryNote: undefined };
}

export type ProbeResult = { state: 'not-found' | 'revoked' | 'expired' } | { state: 'unbound' | 'mine' | 'elsewhere'; invitation: Invitation };

/** What this device can do with the link, before any code is typed. Drives the invite page. */
export async function probeInvitation(ds: Dataset, rawToken: string, deviceId: string, now = new Date()): Promise<ProbeResult> {
  const tokenHash = await sha256Hex(rawToken);
  const found = ds.invitations.find((i) => i.tokenHash === tokenHash);
  if (!found) return { state: 'not-found' };
  if (found.status === 'revoked') return { state: 'revoked' };
  if (new Date(found.expiresAt) < now || found.status === 'expired') return { state: 'expired' };
  if (!found.deviceHash) return { state: 'unbound', invitation: found };
  return { state: found.deviceHash === (await sha256Hex(deviceId)) ? 'mine' : 'elsewhere', invitation: found };
}

/**
 * Open a link from a device. Rules:
 * - The right code on an unbound link makes THIS device the contributor device (firstDevice).
 * - The right code on the bound device opens the full role again.
 * - Any other device gets view-only (per the invitation's `forwarded` setting) and can never contribute.
 * - View-only needs no code when forwarded = 'view' (the default); needs it for 'view-with-code'; refused for 'refuse'.
 */
export async function redeemInvitation(ds: Dataset, rawToken: string, code: string, deviceId: string, now = new Date()): Promise<RedeemResult> {
  const probe = await probeInvitation(ds, rawToken, deviceId, now);
  if (!('invitation' in probe)) return { ok: false, reason: probe.state };
  const inv = probe.invitation;
  const forwarded = inv.forwarded ?? 'view';
  if ((inv.codeAttempts ?? 0) >= MAX_CODE_ATTEMPTS && code.trim()) return { ok: false, reason: 'locked' };
  const codeOk = code.trim().length > 0 && (await sha256Hex(code.trim())) === inv.codeHash;
  if (probe.state === 'elsewhere') {
    if (forwarded === 'refuse') return { ok: false, reason: 'bound-elsewhere' };
    if (forwarded === 'view-with-code' && !codeOk) return { ok: false, reason: code.trim() ? 'bad-code' : 'code-required' };
    return { ok: true, mode: 'view', invitation: inv };
  }
  if (codeOk) return { ok: true, mode: 'full', invitation: inv, firstDevice: probe.state === 'unbound' };
  if (!code.trim() && forwarded === 'view') return { ok: true, mode: 'view', invitation: inv };
  return { ok: false, reason: code.trim() ? 'bad-code' : 'code-required' };
}

/** Bind an invitation to a device (called right after the first successful redeem). */
export async function bindDevice(ds: Dataset, invitationId: string, deviceId: string, deviceLabel?: string): Promise<Dataset> {
  const deviceHash = await sha256Hex(deviceId);
  return { ...ds, invitations: ds.invitations.map((i) => (i.id === invitationId ? { ...i, deviceHash, boundAt: new Date().toISOString(), deviceLabel } : i)) };
}

/** Let the same link be claimed again by the next device that unlocks it. */
export function releaseDevice(ds: Dataset, invitationId: string): Dataset {
  return { ...ds, invitations: ds.invitations.map((i) => (i.id === invitationId ? { ...i, deviceHash: undefined, boundAt: undefined, deviceLabel: undefined, releasedAt: new Date().toISOString(), codeAttempts: 0 } : i)) };
}

/** Wrong codes allowed before the link locks (the admin presses Release to reset). Six digits is a small space; this keeps guessing pointless. */
export const MAX_CODE_ATTEMPTS = 8;

/** Is this session still valid right now? Full sessions must still be on the bound device. Used on every load of the invite page. */
export async function sessionStillValid(ds: Dataset, invitationId: string, deviceId: string, mode: 'full' | 'view', now = new Date()): Promise<boolean> {
  const inv = ds.invitations.find((i) => i.id === invitationId);
  if (!inv || inv.status === 'revoked' || new Date(inv.expiresAt) < now) return false;
  if (mode === 'view') return (inv.forwarded ?? 'view') !== 'refuse' || inv.deviceHash === (await sha256Hex(deviceId));
  if (!inv.deviceHash) return false;
  return inv.deviceHash === (await sha256Hex(deviceId));
}

/** Grant an access request: a fresh contributor invitation in the requester's name, scoped like the link they came in on. */
export async function grantAccessRequest(ds: Dataset, requestId: string, role: Role = 'contributor', days = 30): Promise<{ ds: Dataset; created: CreatedInvitation } | null> {
  const req = ds.accessRequests.find((r) => r.id === requestId);
  if (!req) return null;
  const via = ds.invitations.find((i) => i.id === req.viaInvitationId);
  const scope: AccessScope = via ? { ...via.scope } : { branches: ['paternal', 'maternal'], personIds: [], includeLivingDetails: false };
  const created = await createInvitation({ recipientName: req.name, email: req.email, deliveryNote: req.phone ? `text ${req.phone}` : undefined, role, scope, days });
  const next: Dataset = {
    ...ds,
    invitations: [created.invitation, ...ds.invitations],
    accessRequests: ds.accessRequests.map((r) => (r.id === requestId ? { ...r, status: 'granted', grantedInvitationId: created.invitation.id } : r)),
  };
  return { ds: next, created };
}

export function submitAccessRequest(ds: Dataset, r: Omit<AccessRequest, 'id' | 'submittedAt' | 'status'>): { ds: Dataset; request: AccessRequest } {
  const request: AccessRequest = { ...r, id: newId('req'), submittedAt: new Date().toISOString(), status: 'new' };
  return { ds: { ...ds, accessRequests: [request, ...ds.accessRequests] }, request };
}

/** A stable per-browser id, created once and kept in local storage. "Device" here means this browser profile on this device. */
export function getDeviceId(): string {
  const KEY = 'family-history:device-id';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = randomToken(24);
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return 'no-storage-' + randomToken(8);
  }
}

export function describeDevice(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'browser';
  return `${os} ${br}`;
}

/** Default scope for a relative: the branch they belong to, worked out from the tree. */
export function suggestScope(ds: Dataset, personId?: string): AccessScope {
  if (!personId) return { branches: [], personIds: [], includeLivingDetails: false };
  const p = ds.people.find((x) => x.id === personId);
  if (!p) return { branches: [], personIds: [], includeLivingDetails: false };
  const branches: AccessScope['branches'] = p.branch === 'both' ? ['paternal', 'maternal', 'household'] : p.branch === 'self' || p.branch === 'household' ? ['paternal', 'maternal', 'household'] : [p.branch, 'household'];
  // Their own people by name, whatever branch they were filed under: partners, parents, children, grandchildren.
  const ids = new Set<string>([personId]);
  for (const { person } of partnersOf(ds, personId)) ids.add(person.id);
  for (const x of parentsOf(ds, personId)) ids.add(x.id);
  for (const c of childrenOf(ds, personId)) { ids.add(c.id); for (const { person } of partnersOf(ds, c.id)) ids.add(person.id); for (const g of childrenOf(ds, c.id)) ids.add(g.id); }
  void ancestorDistances;
  return { branches, personIds: [...ids], includeLivingDetails: false };
}
