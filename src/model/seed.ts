import type { Dataset, Person } from './types';

// The PUBLIC seed: an empty archive with one root person and no personal facts.
// The real family data never lives in this repository. It comes from one of:
//   1. cloud mode: the Supabase `family_documents` row (the normal case once deployed);
//   2. local mode on the admin's own computer: `data/private/family-dataset.json`, served by
//      server.cjs at /family-history/private/family-dataset.json and loaded on first run;
//   3. a JSON backup restored from Admin > Export & backup.
// `data/private/` is git-ignored. See docs/PRIVACY.md.

export const ROOT_ID = 'p-root';
export const DEREN_ID = ROOT_ID; // kept for older imports and tests

export function seedDataset(): Dataset {
  const now = new Date().toISOString();
  const root: Person = {
    id: ROOT_ID,
    givenNames: 'You',
    surname: '',
    living: 'yes',
    branch: 'self',
    generation: 0,
    bio: 'The starting person of this archive. Edit this record in Admin > People, or restore a backup.',
    confidence: 'verified',
    placeholder: false,
    privacy: 'family',
    updatedAt: now,
  };
  const slot = (id: string, label: string, branch: Person['branch'], sex: Person['sex']): Person => ({
    id, givenNames: label, surname: '', sex, living: 'unknown', branch, generation: 1, confidence: 'unresearched', placeholder: true, privacy: 'family', openQuestions: ['Full name', 'Birth date and place', 'Living or deceased'], updatedAt: now,
  });
  const father = slot('p-father', 'Father (name needed)', 'paternal', 'M');
  const mother = slot('p-mother', 'Mother (name needed)', 'maternal', 'F');
  return {
    schemaVersion: 1,
    people: [root, father, mother],
    relationships: [
      { id: 'r-father-root', type: 'parent-child', fromId: father.id, toId: root.id, status: 'unverified', sourceIds: [] },
      { id: 'r-mother-root', type: 'parent-child', fromId: mother.id, toId: root.id, status: 'unverified', sourceIds: [] },
    ],
    events: [],
    places: [],
    sources: [],
    media: [],
    questions: [{ id: 'q-start', title: 'Who are the root person\'s parents and grandparents?', personIds: [ROOT_ID], status: 'open', priority: 'high', createdAt: now }],
    invitations: [],
    contributions: [],
    accessRequests: [],
    audit: [{ id: 'a-seed', at: now, actor: 'setup', action: 'seed', entity: 'dataset', after: 'Empty archive created' }],
    settings: {
      familyName: 'Family',
      rootPersonId: ROOT_ID,
      colors: { paternal: '#2F5D50', maternal: '#8C3B3B', self: '#B08D57', household: '#4A6FA5', unknown: '#8a8a8a' },
      theme: 'parchment',
      seedVersion: 0,
    },
  };
}
