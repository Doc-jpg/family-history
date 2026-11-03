import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { AccessScope, Dataset } from '../src/model/types';
import { redact } from '../src/model/access';
import { gapsFor, relativesOf } from '../src/model/perspective';
import { howRelated } from '../src/model/graph';
import { seedDataset } from '../src/model/seed';

// Checks on the real (git-ignored) dataset; ids and expected labels live beside it, not here.
const path = 'data/private/family-dataset.json';
const expPath = 'data/private/perspective-expectations.json';
const has = existsSync(path) && existsSync(expPath);

interface Exp { me: string; scope: AccessScope; labels: Record<string, string>; inLaw: string; inLawLabel: string; spouse: string; gapExpected: string; gapAbsent: string[]; gapPresent: string[] }

describe.skipIf(!has)('a relative sees the family from where they stand', () => {
  const ds = (has ? JSON.parse(readFileSync(path, 'utf8')) : seedDataset()) as Dataset;
  const x = (has ? JSON.parse(readFileSync(expPath, 'utf8')) : {}) as Exp;
  it('labels everyone relative to the invitee and genders in-laws correctly', () => {
    const scoped = redact(ds, x.scope);
    const groups = relativesOf(scoped, x.me);
    const flat = groups.flatMap((g) => g.entries.map((e) => [e.person.id, e.label]));
    const label = (id: string) => flat.find(([i]) => i === id)?.[1];
    for (const [id, want] of Object.entries(x.labels)) expect(label(id)).toBe(want);
    expect(label(x.inLaw)).toMatch(new RegExp(`^${x.inLawLabel}`));
    expect(groups[0].title).toBe('Your parents and grandparents');
  });
  it('asks only about the invitee and their own ancestors, not for facts that are recorded but withheld', () => {
    const scoped = redact(ds, { ...x.scope, personIds: [x.me, x.spouse] });
    const gaps = gapsFor(scoped, x.me, 50);
    expect(gaps.some((g) => g.personId === x.spouse)).toBe(false);
    expect(gaps.some((g) => g.id === x.gapExpected)).toBe(true);
    for (const id of x.gapAbsent) expect(gaps.some((g) => g.id === id)).toBe(false);
    for (const id of x.gapPresent) expect(gaps.some((g) => g.id === id)).toBe(true);
  });
  it('howRelated regenders through-partner in-laws and never loops', () => {
    expect(howRelated(ds, x.inLaw, x.me).label).toMatch(new RegExp(`^${x.inLawLabel}`));
    expect(howRelated(ds, x.me, x.inLaw).label).toMatch(/-in-law/);
  });
});

describe('perspective on a synthetic family', () => {
  it('groups a parent, a child and a spouse from the root person\'s point of view', () => {
    const ds = seedDataset();
    const now = new Date().toISOString();
    const mk = (id: string, givenNames: string, sex: 'M' | 'F', generation: number) => ({ id, givenNames, surname: 'Test', sex, living: 'yes' as const, branch: 'paternal' as const, generation, confidence: 'verified' as const, placeholder: false, privacy: 'family' as const, updatedAt: now });
    ds.people = [ds.people[0], mk('t-dad', 'Dad', 'M', 1), mk('t-kid', 'Kid', 'F', -1), mk('t-wife', 'Wife', 'F', 0)];
    ds.people[0].sex = 'M';
    ds.relationships = [
      { id: 'r1', type: 'parent-child', fromId: 't-dad', toId: ds.people[0].id, status: 'verified', sourceIds: [] },
      { id: 'r2', type: 'parent-child', fromId: ds.people[0].id, toId: 't-kid', status: 'verified', sourceIds: [] },
      { id: 'r3', type: 'partner', fromId: ds.people[0].id, toId: 't-wife', subtype: 'marriage', status: 'verified', sourceIds: [] },
    ];
    const groups = relativesOf(ds, ds.people[0].id);
    expect(groups.map((g) => g.title)).toEqual(['Your parents and grandparents', 'Your partner, children and grandchildren']);
    expect(groups[1].entries.map((e) => e.label).sort()).toEqual(['daughter', 'spouse']);
    const gaps = gapsFor(ds, ds.people[0].id);
    expect(gaps.some((g) => g.question === "Who was Dad's other parent?" || g.question === 'Who was your other parent?')).toBe(true);
  });
});
