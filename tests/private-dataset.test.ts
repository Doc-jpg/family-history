import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Dataset } from '../src/model/types';
import { howRelated } from '../src/model/graph';
import { toGedcom } from '../src/model/gedcom';

// Checks on the real (git-ignored) family dataset. Skipped when the file is absent (CI, other machines).
const path = 'data/private/family-dataset.json';
const has = existsSync(path);

describe.skipIf(!has)('private family dataset', () => {
  const ds = (has ? JSON.parse(readFileSync(path, 'utf8')) : { people: [], events: [], settings: {} }) as Dataset;
  it('has a root, sources on every event, and no placeholder leaks into GEDCOM', () => {
    expect(ds.people.some((p) => p.id === ds.settings.rootPersonId)).toBe(true);
    expect(ds.events.filter((e) => !e.sourceIds.length)).toEqual([]);
    expect(toGedcom(ds)).not.toContain('name needed');
  });
  it('relationship labels hold across the recorded generations', () => {
    const root = ds.settings.rootPersonId;
    const label = (id: string) => (ds.people.some((p) => p.id === id) ? howRelated(ds, id, root).label : 'absent');
    // Expected labels live beside the private dataset so no family ids appear in the public tests.
    const expPath = 'data/private/relation-expectations.json';
    const expected: Record<string, string> = existsSync(expPath) ? JSON.parse(readFileSync(expPath, 'utf8')) : {};
    for (const [id, want] of Object.entries(expected)) {
      if (label(id) !== 'absent') expect(label(id)).toBe(want);
    }
  });
});
