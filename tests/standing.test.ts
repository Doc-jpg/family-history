import { describe, expect, it } from 'vitest';
import { seedDataset } from '../src/model/seed';
import { attest, needsConfirmation, resolveDispute, standingOf } from '../src/model/standing';
import { mergeServerChanges } from '../src/model/merge';
import type { Dataset } from '../src/model/types';

function withPerson(): { ds: Dataset; id: string } {
  const ds = seedDataset();
  const id = 'p-x';
  ds.people.push({ id, givenNames: 'Told', surname: 'Byone', sex: 'F', living: 'no', branch: 'paternal', generation: 2, confidence: 'likely', placeholder: false, privacy: 'family', updatedAt: 'now' });
  return { ds, id };
}

describe('pencil and pen', () => {
  it('one voice is pencil, a second different voice is pen', () => {
    let { ds, id } = withPerson();
    expect(standingOf(ds, id).standing).toBe('unattested');
    ds = attest(ds, { personId: id, by: 'inv-a', byName: 'Aunt A', stance: 'confirm' });
    expect(standingOf(ds, id).standing).toBe('pencil');
    ds = attest(ds, { personId: id, by: 'inv-a', byName: 'Aunt A', stance: 'confirm' }); // same person again does not count twice
    expect(standingOf(ds, id).standing).toBe('pencil');
    ds = attest(ds, { personId: id, by: 'inv-b', byName: 'Uncle B', stance: 'confirm' });
    expect(standingOf(ds, id).standing).toBe('pen');
    expect(standingOf(ds, id).summary).toContain('Aunt A, Uncle B');
  });
  it('a dispute drops pen back to pencil until confirmations outnumber it by two, or the admin settles it', () => {
    let { ds, id } = withPerson();
    ds = attest(ds, { personId: id, by: 'inv-a', byName: 'A', stance: 'confirm' });
    ds = attest(ds, { personId: id, by: 'inv-b', byName: 'B', stance: 'confirm' });
    ds = attest(ds, { personId: id, by: 'inv-c', byName: 'C', stance: 'dispute', note: 'wrong year' });
    expect(standingOf(ds, id).standing).toBe('disputed');
    ds = attest(ds, { personId: id, by: 'inv-d', byName: 'D', stance: 'confirm' });
    expect(standingOf(ds, id).standing).toBe('pen'); // 3 confirm vs 1 dispute
    ds = attest(ds, { personId: id, by: 'inv-d', byName: 'D', stance: 'dispute' }); // D changes their mind
    expect(standingOf(ds, id).standing).toBe('disputed');
    const open = standingOf(ds, id).disputes;
    ds = resolveDispute(ds, open[0].id, 'checked the certificate');
    ds = resolveDispute(ds, open[1].id, 'checked the certificate');
    expect(standingOf(ds, id).standing).toBe('pen');
  });
  it('a documented record stays pen; a dispute becomes a research flag', () => {
    let { ds, id } = withPerson();
    ds.sources.push({ id: 's-doc', title: 'Death certificate', repository: 'State archive', confidence: 'verified', accessedOn: '2026-01-01' });
    ds.events.push({ id: 'e-d', type: 'death', personIds: [id], date: { year: 1990 }, sourceIds: ['s-doc'], confidence: 'verified' });
    expect(standingOf(ds, id).standing).toBe('documented');
    ds = attest(ds, { personId: id, by: 'inv-c', byName: 'C', stance: 'dispute', note: 'I think 1991' });
    const d = standingOf(ds, id);
    expect(d.standing).toBe('documented');
    expect(d.summary).toContain('flagged for research');
  });
  it('asks a relative only about pencil or disputed people they have not weighed in on', () => {
    let { ds, id } = withPerson();
    ds = attest(ds, { personId: id, by: 'inv-a', byName: 'A', stance: 'confirm' });
    expect(needsConfirmation(ds, ds.people, 'inv-b').map((x) => x.person.id)).toEqual([id]);
    expect(needsConfirmation(ds, ds.people, 'inv-a')).toEqual([]);
  });
  it('survives the admin merge: a stance recorded on the server is kept, a settled dispute stays settled', () => {
    const { ds, id } = withPerson();
    const server = attest(ds, { personId: id, by: 'inv-a', byName: 'A', stance: 'dispute', note: 'x' });
    const local = resolveDispute(server, server.attestations![0].id, 'settled');
    const serverLater = attest(server, { personId: id, by: 'inv-b', byName: 'B', stance: 'confirm' });
    const m = mergeServerChanges(local, serverLater);
    expect(m.attestations!.find((a) => a.by === 'inv-a')!.resolvedAt).toBeTruthy();
    expect(m.attestations!.some((a) => a.by === 'inv-b')).toBe(true);
    expect(standingOf(m, id).standing).toBe('pencil');
  });
});
