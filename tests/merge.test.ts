import { describe, expect, it } from 'vitest';
import { seedDataset } from '../src/model/seed';
import { mergeServerChanges } from '../src/model/merge';
import type { Contribution, Invitation } from '../src/model/types';

const inv = (over: Partial<Invitation> = {}): Invitation => ({ id: 'inv-1', recipientName: 'Aunt Test', role: 'contributor', scope: { branches: ['paternal'], personIds: [], includeLivingDetails: false }, tokenHash: 't', codeHash: 'c', status: 'pending', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', ...over });
const contrib = (id: string, status: Contribution['status'] = 'new'): Contribution => ({ id, invitationId: 'inv-1', contributorName: 'Aunt Test', kind: 'memory', subject: { type: 'branch', label: 'family' }, proposal: 'x', fields: {}, attachmentMediaIds: [], submittedAt: '2026-02-01T00:00:00Z', status, history: [] });

describe('mergeServerChanges', () => {
  it('keeps contributions and requests that only the server has, and the admin review decisions', () => {
    const local = { ...seedDataset(), contributions: [contrib('c1', 'approved')] };
    const server = { ...seedDataset(), contributions: [contrib('c1', 'new'), contrib('c2')], accessRequests: [{ id: 'r1', name: 'Cousin', relationship: 'cousin', submittedAt: '2026-02-02T00:00:00Z', status: 'new' as const }] };
    const m = mergeServerChanges(local, server);
    expect(m.contributions.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(m.contributions.find((c) => c.id === 'c1')!.status).toBe('approved');
    expect(m.accessRequests.map((r) => r.id)).toEqual(['r1']);
  });
  it('takes a device binding made on the server, but not after the admin released it', () => {
    const local = { ...seedDataset(), invitations: [inv()] };
    const server = { ...seedDataset(), invitations: [inv({ status: 'active', deviceHash: 'd', boundAt: '2026-03-01T00:00:00Z', deviceLabel: 'iPhone Safari', activatedAt: '2026-03-01T00:00:00Z' })] };
    const m = mergeServerChanges(local, server);
    expect(m.invitations[0].deviceHash).toBe('d');
    expect(m.invitations[0].status).toBe('active');
    const released = { ...local, invitations: [inv({ releasedAt: '2026-03-02T00:00:00Z' })] };
    expect(mergeServerChanges(released, server).invitations[0].deviceHash).toBeUndefined();
  });
  it('lets the admin revoke and keeps the admin copy of everything else', () => {
    const local = { ...seedDataset(), invitations: [inv({ status: 'revoked' })], settings: { ...seedDataset().settings, familyName: 'Mine' } };
    const server = { ...seedDataset(), invitations: [inv({ status: 'active', deviceHash: 'd', boundAt: '2026-03-01T00:00:00Z' })], settings: { ...seedDataset().settings, familyName: 'Theirs' } };
    const m = mergeServerChanges(local, server);
    expect(m.invitations[0].status).toBe('revoked');
    expect(m.settings.familyName).toBe('Mine');
  });
});
