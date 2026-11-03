import type { Dataset, Invitation } from './types';

// In cloud mode two parties change the one family document:
//   - the admin, from the app, who holds a full copy in memory and saves it whole;
//   - the `invite` edge function, on behalf of relatives, which appends contributions,
//     access requests, media records and audit entries and binds devices to invitations.
// Before the admin's copy is written back it is merged with the server copy so nothing a
// relative did in the meantime is lost. Rules:
//   - contributions, access requests, media, audit: union by id. The admin's version of an
//     entry wins (that is where review decisions live); entries only the server has are kept.
//   - invitations: union by id; the admin's record wins for everything except the device
//     binding and activity fields, which come from whichever side has the newer activity,
//     unless the admin released the device after the server bound it.
//   - everything else (people, events, settings...) is the admin's.
// Pure function, unit-tested.

export function mergeServerChanges(local: Dataset, server: Dataset): Dataset {
  const unionById = <T extends { id: string }>(mine: T[], theirs: T[]): T[] => {
    const ids = new Set(mine.map((x) => x.id));
    return [...mine, ...theirs.filter((x) => !ids.has(x.id))];
  };
  const byId = new Map(server.invitations.map((i) => [i.id, i]));
  const invitations: Invitation[] = local.invitations.map((mine) => {
    const theirs = byId.get(mine.id);
    if (!theirs) return mine;
    return mergeInvitation(mine, theirs);
  });
  const localIds = new Set(local.invitations.map((i) => i.id));
  for (const theirs of server.invitations) if (!localIds.has(theirs.id)) invitations.push(theirs);
  return {
    ...local,
    invitations,
    contributions: sortNewest(unionById(local.contributions, server.contributions), 'submittedAt'),
    accessRequests: sortNewest(unionById(local.accessRequests ?? [], server.accessRequests ?? []), 'submittedAt'),
    media: unionById(local.media, server.media),
    audit: sortNewest(unionById(local.audit, server.audit), 'at'),
  };
}

function mergeInvitation(mine: Invitation, theirs: Invitation): Invitation {
  const out: Invitation = { ...mine };
  // The admin released the device after the server bound it: the release stands.
  const released = mine.releasedAt && (!theirs.boundAt || mine.releasedAt > theirs.boundAt);
  if (!released && theirs.deviceHash && (!mine.deviceHash || (theirs.boundAt ?? '') > (mine.boundAt ?? ''))) {
    out.deviceHash = theirs.deviceHash;
    out.boundAt = theirs.boundAt;
    out.deviceLabel = theirs.deviceLabel;
  }
  if ((theirs.lastSeenAt ?? '') > (mine.lastSeenAt ?? '')) out.lastSeenAt = theirs.lastSeenAt;
  if (theirs.activatedAt && !mine.activatedAt) out.activatedAt = theirs.activatedAt;
  if ((theirs.codeAttempts ?? 0) > (mine.codeAttempts ?? 0) && !mine.releasedAt) out.codeAttempts = theirs.codeAttempts;
  // Revoked/expired by the admin always wins; otherwise an activation on the server is kept.
  if (mine.status === 'pending' && theirs.status === 'active') out.status = 'active';
  return out;
}

function sortNewest<T>(arr: T[], key: keyof T): T[] {
  return [...arr].sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')));
}
