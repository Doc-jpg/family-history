import { describe, expect, it } from 'vitest';
import { seedDataset, DEREN_ID } from '../src/model/seed';
import { howRelated, parseDate, formatDate, siblingsOf } from '../src/model/graph';
import { bindDevice, createInvitation, grantAccessRequest, probeInvitation, redact, redeemInvitation, releaseDevice, sessionStillValid, submitAccessRequest, visiblePeople } from '../src/model/access';
import { applyPersonCorrection, reviewContribution, rollbackPerson, submitContribution } from '../src/model/review';
import { toGedcom } from '../src/model/gedcom';
import type { Dataset, Person } from '../src/model/types';

function withFamily(): Dataset {
  // Clearly fake test people (never real family data).
  const ds = seedDataset();
  ds.people[0].sex = 'M'; // the generic root has no sex; the test family needs one for 'son'
  const mk = (id: string, given: string, sur: string, sex: 'M' | 'F', gen: number, branch: Person['branch'], living: Person['living'] = 'no'): Person => ({ id, givenNames: given, surname: sur, sex, living, branch, generation: gen, confidence: 'likely', placeholder: false, privacy: 'family', updatedAt: 't' });
  ds.people = ds.people.filter((p) => !p.placeholder);
  ds.relationships = ds.relationships.filter((r) => ds.people.some((p) => p.id === r.fromId) && ds.people.some((p) => p.id === r.toId));
  ds.people.push(mk('t-spouse', 'TestSpouse', 'Root', 'F', 0, 'household', 'yes'), mk('t-child', 'TestChild', 'Root', 'M', -1, 'household', 'yes'));
  ds.relationships.push({ id: 'r-sp', type: 'partner', fromId: DEREN_ID, toId: 't-spouse', subtype: 'marriage', status: 'verified', sourceIds: [] }, { id: 'r-ch1', type: 'parent-child', fromId: DEREN_ID, toId: 't-child', status: 'verified', sourceIds: [] }, { id: 'r-ch2', type: 'parent-child', fromId: 't-spouse', toId: 't-child', status: 'verified', sourceIds: [] });
  ds.places.push({ id: 'pl-test', name: 'Test Town' });
  ds.people.push(mk('t-f', 'TestFather', 'Placeholderson', 'M', 1, 'paternal', 'yes'), mk('t-m', 'TestMother', 'Placeholderdottir', 'F', 1, 'maternal', 'yes'), mk('t-pgf', 'TestGrandpa', 'Placeholderson', 'M', 2, 'paternal'), mk('t-pgm', 'TestGrandma', 'Placeholderson', 'F', 2, 'paternal'), mk('t-uncle', 'TestUncle', 'Placeholderson', 'M', 1, 'paternal', 'yes'), mk('t-cousin', 'TestCousin', 'Placeholderson', 'F', 0, 'paternal', 'yes'), mk('t-sis', 'TestSister', 'Placeholderson', 'F', 0, 'both', 'yes'));
  const pc = (a: string, b: string) => ds.relationships.push({ id: `r-${a}-${b}`, type: 'parent-child', fromId: a, toId: b, status: 'verified', sourceIds: [] });
  pc('t-f', DEREN_ID); pc('t-m', DEREN_ID); pc('t-f', 't-sis'); pc('t-m', 't-sis');
  pc('t-pgf', 't-f'); pc('t-pgm', 't-f'); pc('t-pgf', 't-uncle'); pc('t-pgm', 't-uncle'); pc('t-uncle', 't-cousin');
  ds.events.push({ id: 'e-pgf-b', type: 'birth', personIds: ['t-pgf'], date: { year: 1930 }, sourceIds: [], confidence: 'tentative' });
  ds.events.push({ id: 'e-f-b', type: 'birth', personIds: ['t-f'], date: { year: 1931 }, placeId: 'pl-test', sourceIds: [], confidence: 'likely' });
  return ds;
}

describe('public seed', () => {
  it('holds no personal facts: one root named "You", two empty slots, no events or sources', () => {
    const ds = seedDataset();
    expect(ds.people.map((p) => p.givenNames)).toEqual(['You', 'Father (name needed)', 'Mother (name needed)']);
    expect(ds.events).toEqual([]);
    expect(ds.sources).toEqual([]);
    expect(JSON.stringify(ds)).not.toMatch(/Statement by|Obituary/);
  });
});

describe('dates', () => {
  it('parses common shapes', () => {
    expect(parseDate('1984-06-15')).toEqual({ year: 1984, month: 6, day: 15, approx: undefined });
    expect(parseDate('about 1902')).toEqual({ year: 1902, approx: true });
    expect(parseDate('6/15/1984')).toEqual({ year: 1984, month: 6, day: 15, approx: undefined });
    expect(parseDate('spring 1880')?.year).toBe(1880);
    expect(formatDate({ year: 1984, month: 6, day: 15 })).toBe('15 Jun 1984');
  });
});

describe('relationships', () => {
  const ds = withFamily();
  it('names direct relations', () => {
    expect(howRelated(ds, 't-f', DEREN_ID).label).toBe('father');
    expect(howRelated(ds, DEREN_ID, 't-f').label).toBe('son');
    expect(howRelated(ds, 't-pgf', DEREN_ID).label).toBe('grandfather');
    expect(howRelated(ds, 't-sis', DEREN_ID).label).toBe('sister');
    expect(howRelated(ds, 't-uncle', DEREN_ID).label).toBe('uncle');
    expect(howRelated(ds, 't-cousin', DEREN_ID).label).toBe('first cousin');
    expect(howRelated(ds, 't-cousin', 't-child').label).toBe('first cousin once removed');
    expect(howRelated(ds, 't-spouse', DEREN_ID).label).toBe('spouse');
    expect(howRelated(ds, 't-spouse', 't-f').label).toContain('in-law');
  });
  it('returns the connecting path through the common ancestor', () => {
    const r = howRelated(ds, 't-cousin', DEREN_ID);
    expect(r.commonAncestorIds.sort()).toEqual(['t-pgf', 't-pgm']);
    expect(r.path[0]).toBe('t-cousin');
    expect(r.path[r.path.length - 1]).toBe(DEREN_ID);
  });
  it('finds siblings', () => {
    expect(siblingsOf(ds, DEREN_ID).map((p) => p.id).sort()).toEqual(['t-sis']);
  });
});

describe('access scoping', () => {
  const ds = withFamily();
  it('hides placeholders and private people, shows the root', () => {
    const seed = seedDataset();
    const vis = visiblePeople(seed, { branches: ['paternal', 'maternal'], personIds: [], includeLivingDetails: false });
    expect(vis.some((p) => p.placeholder)).toBe(false);
    expect(vis.map((p) => p.id)).toContain(DEREN_ID);
  });
  it('restricts to the granted branch', () => {
    const vis = visiblePeople(ds, { branches: ['paternal'], personIds: [], includeLivingDetails: false }).map((p) => p.id);
    expect(vis).toContain('t-pgf');
    expect(vis).toContain('t-sis'); // both
    expect(vis).not.toContain('t-m');
    expect(vis).not.toContain('t-spouse'); // household not granted
  });
  it('withholds birth details of living people unless allowed', () => {
    const r = redact(ds, { branches: ['paternal'], personIds: [], includeLivingDetails: false });
    expect(r.events.find((e) => e.id === 'e-f-b')).toBeUndefined(); // living father, birth withheld
    expect(r.events.find((e) => e.id === 'e-pgf-b')).toBeDefined(); // deceased grandfather, shown
    expect(r.people.every((p) => p.notes === undefined)).toBe(true);
    const r2 = redact(ds, { branches: ['paternal'], personIds: [], includeLivingDetails: true });
    expect(r2.events.find((e) => e.id === 'e-f-b')).toBeDefined();
  });
  it('never leaks invitations, contributions or audit to a relative', () => {
    const r = redact(ds, { branches: ['paternal', 'maternal'], personIds: [], includeLivingDetails: true });
    expect(r.invitations).toEqual([]);
    expect(r.contributions).toEqual([]);
    expect(r.audit).toEqual([]);
  });
});

describe('invitations', () => {
  const A = 'device-A', B = 'device-B';
  it('stores only hashes and needs both the link token and the code to contribute', async () => {
    const ds = seedDataset();
    const made = await createInvitation({ recipientName: 'Test Aunt', role: 'contributor', scope: { branches: ['paternal'], personIds: [], includeLivingDetails: false } });
    ds.invitations.push(made.invitation);
    expect(JSON.stringify(made.invitation)).not.toContain(made.rawToken);
    expect(JSON.stringify(made.invitation)).not.toContain(made.code);
    const r = await redeemInvitation(ds, made.rawToken, made.code, A);
    expect(r.ok && r.mode === 'full' && r.firstDevice).toBe(true);
    expect((await redeemInvitation(ds, made.rawToken, '000001', A)).ok).toBe(false);
    expect((await redeemInvitation(ds, 'wrong', made.code, A)).ok).toBe(false);
  });
  it('first device with the code becomes the contributor device; other devices get view-only even with the code', async () => {
    let ds = seedDataset();
    const made = await createInvitation({ recipientName: 'Mom', role: 'contributor', scope: { branches: ['maternal'], personIds: [], includeLivingDetails: false } });
    ds.invitations.push(made.invitation);
    ds = await bindDevice(ds, made.invitation.id, A, 'iPhone Safari');
    expect(ds.invitations[0].deviceHash).toBeDefined();
    expect(JSON.stringify(ds.invitations[0])).not.toContain(A);
    const again = await redeemInvitation(ds, made.rawToken, made.code, A);
    expect(again.ok && again.mode === 'full' && !again.firstDevice).toBe(true);
    const sister = await redeemInvitation(ds, made.rawToken, made.code, B);
    expect(sister.ok && sister.mode === 'view').toBe(true);
    const sisterNoCode = await redeemInvitation(ds, made.rawToken, '', B);
    expect(sisterNoCode.ok && sisterNoCode.mode === 'view').toBe(true);
    expect((await probeInvitation(ds, made.rawToken, B))).toMatchObject({ state: 'elsewhere' });
    expect(await sessionStillValid(ds, made.invitation.id, B, 'full')).toBe(false);
    expect(await sessionStillValid(ds, made.invitation.id, B, 'view')).toBe(true);
    expect(await sessionStillValid(ds, made.invitation.id, A, 'full')).toBe(true);
  });
  it('honors the forwarded setting: view-with-code and refuse', async () => {
    let ds = seedDataset();
    const made = await createInvitation({ recipientName: 'Mom', role: 'contributor', scope: { branches: ['maternal'], personIds: [], includeLivingDetails: false } });
    ds.invitations.push({ ...made.invitation, forwarded: 'view-with-code' });
    ds = await bindDevice(ds, made.invitation.id, A);
    expect(await redeemInvitation(ds, made.rawToken, '', B)).toEqual({ ok: false, reason: 'code-required' });
    const withCode = await redeemInvitation(ds, made.rawToken, made.code, B);
    expect(withCode.ok && withCode.mode === 'view').toBe(true);
    ds.invitations[0].forwarded = 'refuse';
    expect(await redeemInvitation(ds, made.rawToken, made.code, B)).toEqual({ ok: false, reason: 'bound-elsewhere' });
    // an unbound link with forwarded=refuse still needs the code to open at all
    const strict = await createInvitation({ recipientName: 'Uncle', role: 'viewer', scope: { branches: [], personIds: [], includeLivingDetails: false } });
    ds.invitations.push({ ...strict.invitation, forwarded: 'refuse' });
    expect(await redeemInvitation(ds, strict.rawToken, '', B)).toEqual({ ok: false, reason: 'code-required' });
  });
  it('release lets a new device claim the link once', async () => {
    let ds = seedDataset();
    const made = await createInvitation({ recipientName: 'Mom', role: 'contributor', scope: { branches: ['maternal'], personIds: [], includeLivingDetails: false } });
    ds.invitations.push(made.invitation);
    ds = await bindDevice(ds, made.invitation.id, A);
    ds = releaseDevice(ds, made.invitation.id);
    const r = await redeemInvitation(ds, made.rawToken, made.code, B);
    expect(r.ok && r.mode === 'full' && r.firstDevice).toBe(true);
  });
  it('refuses revoked and expired invitations', async () => {
    const ds = seedDataset();
    const made = await createInvitation({ recipientName: 'T', role: 'viewer', scope: { branches: [], personIds: [], includeLivingDetails: false }, days: 1 });
    ds.invitations.push({ ...made.invitation, status: 'revoked' });
    expect(await redeemInvitation(ds, made.rawToken, made.code, A)).toEqual({ ok: false, reason: 'revoked' });
    ds.invitations = [made.invitation];
    const later = new Date(Date.now() + 3 * 86400000);
    expect(await redeemInvitation(ds, made.rawToken, made.code, A, later)).toEqual({ ok: false, reason: 'expired' });
  });
  it('access request becomes its own invitation with its own code, scoped like the link it came in on', async () => {
    let ds = seedDataset();
    const mom = await createInvitation({ recipientName: 'Mom', role: 'contributor', scope: { branches: ['maternal'], personIds: [], includeLivingDetails: false } });
    ds.invitations.push(mom.invitation);
    const { ds: d1, request } = submitAccessRequest(ds, { name: "Mom's sister", relationship: 'aunt', phone: '555', viaInvitationId: mom.invitation.id });
    expect(d1.accessRequests[0].status).toBe('new');
    const granted = await grantAccessRequest(d1, request.id);
    expect(granted).not.toBeNull();
    const inv = granted!.ds.invitations.find((i) => i.id === granted!.created.invitation.id)!;
    expect(inv.recipientName).toBe("Mom's sister");
    expect(inv.scope.branches).toEqual(['maternal']);
    expect(inv.codeHash).not.toBe(mom.invitation.codeHash);
    expect(granted!.ds.accessRequests[0].status).toBe('granted');
    const r = await redeemInvitation(granted!.ds, granted!.created.rawToken, granted!.created.code, B);
    expect(r.ok && r.mode === 'full').toBe(true);
  });
});

describe('contributions and review', () => {
  it('submission never changes the record; approval applies it; rollback restores it', () => {
    let ds = withFamily();
    const before = ds.people.find((p) => p.id === 't-pgf')!;
    const { ds: d1, contribution } = submitContribution(ds, { invitationId: 'inv-x', contributorName: 'Test Aunt', kind: 'correction', subject: { type: 'person', id: 't-pgf', label: 'TestGrandpa' }, proposal: 'His name was spelled Grandpa', fields: { givenNames: 'TestGrandpaCorrected' }, attachmentMediaIds: [] });
    expect(d1.people.find((p) => p.id === 't-pgf')!.givenNames).toBe(before.givenNames);
    expect(d1.contributions[0].status).toBe('new');
    let d2 = reviewContribution(d1, contribution.id, 'approved', 'admin', 'headstone photo matches');
    d2 = applyPersonCorrection(d2, contribution, 'admin');
    expect(d2.people.find((p) => p.id === 't-pgf')!.givenNames).toBe('TestGrandpaCorrected');
    expect(d2.contributions[0].history.map((h) => h.action)).toEqual(['submitted', 'approved']);
    const entry = d2.audit.find((a) => a.action === 'apply-correction')!;
    const d3 = rollbackPerson(d2, entry.id, 'admin');
    expect(d3.people.find((p) => p.id === 't-pgf')!.givenNames).toBe(before.givenNames);
    ds = d3;
    expect(ds.audit.length).toBeGreaterThan(3);
  });
  it('supports every review outcome without touching people', () => {
    const ds = withFamily();
    const { ds: d1, contribution } = submitContribution(ds, { invitationId: 'i', contributorName: 'X', kind: 'memory', subject: { type: 'person', id: 't-pgf', label: 'g' }, proposal: 'He whistled.', attachmentMediaIds: [] });
    for (const s of ['research', 'clarify', 'partial', 'rejected', 'disputed'] as const) {
      const d = reviewContribution(d1, contribution.id, s, 'admin');
      expect(d.contributions[0].status).toBe(s);
      expect(d.people).toEqual(d1.people);
    }
  });
});

describe('gedcom', () => {
  it('exports named people with families and skips placeholders and private people', () => {
    const ds = withFamily();
    ds.people.find((p) => p.id === 't-uncle')!.privacy = 'private';
    const g = toGedcom(ds);
    expect(g).toContain('0 HEAD');
    expect(g).toContain('1 NAME TestGrandpa /Placeholderson/');
    expect(g).toContain('2 DATE 1931');
    expect(g).toContain('2 PLAC Test Town');
    expect(g).not.toContain('name needed');
    expect(g).not.toContain('TestUncle');
    expect(g).toMatch(/0 @F\d+@ FAM/);
    expect(g).toContain('1 HUSB');
    expect(g).toContain('1 CHIL');
    expect(g.trim().endsWith('0 TRLR')).toBe(true);
    expect(toGedcom(ds, { includePrivate: true })).toContain('TestUncle');
  });
});
