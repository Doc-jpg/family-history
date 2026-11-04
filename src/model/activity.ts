import type { Dataset } from './types';

// What relatives have done, in plain words, newest first. Built from the audit log, the inbox,
// the access requests and the invitations, so the admin can see at a glance who opened their link,
// who sent something, and what is waiting.

export interface ActivityItem { at: string; kind: 'open' | 'submit' | 'confirm' | 'dispute' | 'request' | 'other'; text: string; link?: string }

export function activityFeed(ds: Dataset, limit = 30): ActivityItem[] {
  const items: ActivityItem[] = [];
  const person = (id?: string) => { const p = id ? ds.people.find((x) => x.id === id) : undefined; return p ? `${p.givenNames} ${p.surname}`.trim() : 'someone'; };
  for (const a of ds.audit) {
    if (a.action === 'invitation-opened-and-bound') items.push({ at: a.at, kind: 'open', text: `${a.actor} opened their link for the first time${(a.after as { device?: string } | undefined)?.device ? ` (${(a.after as { device: string }).device})` : ''}`, link: '/admin/invites' });
    else if (a.action === 'invitation-opened') items.push({ at: a.at, kind: 'open', text: `${a.actor} came back to their link`, link: '/admin/invites' });
    else if (a.action === 'forwarded-link-viewed') items.push({ at: a.at, kind: 'open', text: `Someone looked at a forwarded link (view only)`, link: '/admin/invites' });
    else if (a.action === 'confirmed') items.push({ at: a.at, kind: 'confirm', text: `${a.actor} confirmed ${person(a.entityId)} looks right`, link: a.entityId ? `/person/${a.entityId}` : undefined });
    else if (a.action === 'disputed') items.push({ at: a.at, kind: 'dispute', text: `${a.actor} questioned ${person(a.entityId)}${a.after ? `: "${String(a.after).slice(0, 80)}"` : ''}`, link: '/admin/inbox' });
  }
  for (const c of ds.contributions) if (c.kind !== 'dispute') items.push({ at: c.submittedAt, kind: 'submit', text: `${c.contributorName} sent a ${c.kind.replace('-', ' ')} about ${c.subject.label}${c.attachmentMediaIds.length ? ` with ${c.attachmentMediaIds.length} file${c.attachmentMediaIds.length > 1 ? 's' : ''}` : ''}${c.status === 'new' ? ' (waiting for you)' : ''}`, link: '/admin/inbox' });
  for (const r of ds.accessRequests) items.push({ at: r.submittedAt, kind: 'request', text: `${r.name} (${r.relationship}) asked for their own link${r.status === 'new' ? ' (waiting for you)' : ` (${r.status})`}`, link: '/admin/requests' });
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export function waitingCounts(ds: Dataset): { inbox: number; requests: number; disputes: number; unopened: number } {
  return {
    inbox: ds.contributions.filter((c) => c.status === 'new').length,
    requests: ds.accessRequests.filter((r) => r.status === 'new').length,
    disputes: (ds.attestations ?? []).filter((a) => a.stance === 'dispute' && !a.resolvedAt).length,
    unopened: ds.invitations.filter((i) => i.status === 'pending' && i.role !== 'viewer').length, // a look-only link never "opens"; it has no device to bind
  };
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
