import type { DateValue, Dataset, Person, Relationship } from './types';

export function newId(prefix: string): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + '-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function displayName(p: Person): string {
  const parts = [p.givenNames, p.surname].filter(Boolean);
  if (p.maidenName && p.maidenName !== p.surname) parts.push(`(née ${p.maidenName})`);
  return parts.join(' ').trim() || 'Unnamed';
}

export function formatDate(d?: DateValue): string {
  if (!d) return '';
  if (d.text && !d.year) return d.text;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let s = '';
  if (d.day && d.month) s = `${d.day} ${months[d.month - 1]} `;
  else if (d.month) s = `${months[d.month - 1]} `;
  s += d.year ?? '';
  if (d.approx) s = 'about ' + s;
  if (d.text && d.year) s += ` (${d.text})`;
  return s.trim();
}

export function parseDate(input: string): DateValue | undefined {
  const t = input.trim();
  if (!t) return undefined;
  const approx = /^(about|abt|circa|c\.?|~)\s*/i.test(t);
  const core = t.replace(/^(about|abt|circa|c\.?|~)\s*/i, '');
  let m = core.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3], approx: approx || undefined };
  m = core.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return { year: +m[1], month: +m[2], approx: approx || undefined };
  m = core.match(/^(\d{4})$/);
  if (m) return { year: +m[1], approx: approx || undefined };
  m = core.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { year: +m[3], month: +m[1], day: +m[2], approx: approx || undefined };
  const y = core.match(/(\d{4})/);
  return { year: y ? +y[1] : undefined, text: t, approx: approx || undefined };
}

export function personById(ds: Dataset, id: string): Person | undefined {
  return ds.people.find((p) => p.id === id);
}

export function parentsOf(ds: Dataset, id: string): Person[] {
  return ds.relationships
    .filter((r) => r.type === 'parent-child' && r.toId === id)
    .map((r) => personById(ds, r.fromId))
    .filter((p): p is Person => !!p);
}

export function childrenOf(ds: Dataset, id: string): Person[] {
  return ds.relationships
    .filter((r) => r.type === 'parent-child' && r.fromId === id)
    .map((r) => personById(ds, r.toId))
    .filter((p): p is Person => !!p);
}

export function partnersOf(ds: Dataset, id: string): { person: Person; rel: Relationship }[] {
  return ds.relationships
    .filter((r) => r.type === 'partner' && (r.fromId === id || r.toId === id))
    .map((r) => ({ rel: r, person: personById(ds, r.fromId === id ? r.toId : r.fromId) }))
    .filter((x): x is { person: Person; rel: Relationship } => !!x.person);
}

export function siblingsOf(ds: Dataset, id: string): Person[] {
  const parents = parentsOf(ds, id);
  const set = new Map<string, Person>();
  for (const parent of parents) for (const c of childrenOf(ds, parent.id)) if (c.id !== id) set.set(c.id, c);
  return [...set.values()];
}

export function birthYear(ds: Dataset, id: string): number | undefined {
  return ds.events.find((e) => e.type === 'birth' && e.personIds.includes(id))?.date?.year;
}
export function deathYear(ds: Dataset, id: string): number | undefined {
  return ds.events.find((e) => e.type === 'death' && e.personIds.includes(id))?.date?.year;
}

/** Distance to every ancestor (0 = self). */
export function ancestorDistances(ds: Dataset, id: string): Map<string, number> {
  const dist = new Map<string, number>([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const p of parentsOf(ds, cur)) {
      if (!dist.has(p.id)) {
        dist.set(p.id, d + 1);
        queue.push(p.id);
      }
    }
  }
  return dist;
}

const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
function greats(n: number): string {
  if (n <= 0) return '';
  if (n === 1) return 'great-';
  return `${n}x great-`;
}
function timesRemoved(n: number): string {
  if (n === 0) return '';
  if (n === 1) return ' once removed';
  if (n === 2) return ' twice removed';
  return ` ${n} times removed`;
}

export interface RelationResult {
  label: string;
  path: string[]; // person ids along the connection, a to common ancestor(s) to b
  commonAncestorIds: string[];
}

/** How is a related to b? Walks parent-child edges; partner edges only for direct spouses and in-laws. */
export function howRelated(ds: Dataset, aId: string, bId: string, viaPartner = true): RelationResult {
  if (aId === bId) return { label: 'the same person', path: [aId], commonAncestorIds: [] };
  const a = personById(ds, aId);
  const b = personById(ds, bId);
  if (!a || !b) return { label: 'unknown', path: [], commonAncestorIds: [] };

  const partner = partnersOf(ds, aId).find((x) => x.person.id === bId);
  if (partner) return { label: partner.rel.subtype === 'marriage' ? (a.sex === 'M' ? 'husband' : a.sex === 'F' ? 'wife' : 'spouse') : 'partner', path: [aId, bId], commonAncestorIds: [] };

  const da = ancestorDistances(ds, aId);
  const db = ancestorDistances(ds, bId);
  let best: { id: string; x: number; y: number } | undefined;
  for (const [id, x] of da) {
    const y = db.get(id);
    if (y === undefined) continue;
    if (!best || x + y < best.x + best.y) best = { id, x, y };
  }
  if (best) {
    // All common ancestors at the same minimal distance (usually a couple).
    const commons = [...da.entries()].filter(([id, x]) => db.get(id) === best!.y && x === best!.x).map(([id]) => id);
    const { x, y } = best;
    let label: string;
    const femaleA = a.sex === 'F';
    const femaleB = b.sex === 'F';
    if (x === 0) {
      // a is an ancestor of b
      label = y === 1 ? (femaleA ? 'mother' : a.sex === 'M' ? 'father' : 'parent') : `${greats(y - 2)}${femaleA ? 'grandmother' : a.sex === 'M' ? 'grandfather' : 'grandparent'}`;
    } else if (y === 0) {
      label = x === 1 ? (femaleA ? 'daughter' : a.sex === 'M' ? 'son' : 'child') : `${greats(x - 2)}${femaleA ? 'granddaughter' : a.sex === 'M' ? 'grandson' : 'grandchild'}`;
    } else if (x === 1 && y === 1) {
      const full = commons.length >= 2;
      label = `${full ? '' : 'half-'}${femaleA ? 'sister' : a.sex === 'M' ? 'brother' : 'sibling'}`;
    } else if (x === 1) {
      label = `${greats(y - 2)}${femaleA ? 'aunt' : a.sex === 'M' ? 'uncle' : 'aunt/uncle'}`;
    } else if (y === 1) {
      label = `${greats(x - 2)}${femaleA ? 'niece' : a.sex === 'M' ? 'nephew' : 'niece/nephew'}`;
    } else {
      const degree = Math.min(x, y) - 1;
      label = `${ORD[degree] ?? degree + 'th'} cousin${timesRemoved(Math.abs(x - y))}`;
    }
    void femaleB;
    const pathA = chain(ds, aId, best.id, da);
    const pathB = chain(ds, bId, best.id, db).reverse().slice(1);
    return { label, path: [...pathA, ...pathB], commonAncestorIds: commons };
  }
  // In-law through a's partner? (one hop only, so two in-laws never chase each other forever)
  if (!viaPartner) return { label: 'no known connection yet', path: [], commonAncestorIds: [] };
  for (const { person } of partnersOf(ds, aId)) {
    const via = howRelated(ds, person.id, bId, false);
    if (via.label === 'unknown' || !via.path.length) continue;
    // Married to b's parent or grandparent, without being one: a step-parent, not an in-law.
    if (ASCENDANT.test(via.label)) return { label: stepLabel(regender(via.label, a.sex)), path: [aId, ...via.path], commonAncestorIds: via.commonAncestorIds };
    return { label: `${regender(via.label, a.sex)}-in-law (through ${displayName(person)})`, path: [aId, ...via.path], commonAncestorIds: via.commonAncestorIds };
  }
  for (const { person } of partnersOf(ds, bId)) {
    const via = howRelated(ds, aId, person.id, false);
    if (via.label === 'unknown' || !via.path.length || via.label.includes('in-law')) continue;
    if (DESCENDANT.test(via.label)) return { label: stepLabel(via.label), path: [...via.path, bId], commonAncestorIds: via.commonAncestorIds };
    return { label: `${via.label}-in-law (through ${displayName(person)})`, path: [...via.path, bId], commonAncestorIds: via.commonAncestorIds };
  }
  return { label: 'no known connection yet', path: [], commonAncestorIds: [] };
}

const ASCENDANT = /^(great-)*(grand)?(mother|father|parent)$/;
const DESCENDANT = /^(great-)*(grand)?(son|daughter|child)$/;
/** "mother" becomes "stepmother"; "grandfather" becomes "step-grandfather". */
function stepLabel(label: string): string {
  return label.includes('grand') ? `step-${label}` : `step${label}`;
}

/** The partner's role, restated for the in-law's own sex: Deren is Gina's son, so his wife is her daughter-in-law. */
function regender(label: string, sex: Person['sex']): string {
  const pairs: [string, string, string][] = [['son', 'daughter', 'child'], ['brother', 'sister', 'sibling'], ['father', 'mother', 'parent'], ['grandson', 'granddaughter', 'grandchild'], ['grandfather', 'grandmother', 'grandparent'], ['nephew', 'niece', 'niece/nephew'], ['uncle', 'aunt', 'aunt/uncle']];
  for (const [m, f, n] of pairs) {
    const re = new RegExp(`(^|-)(${m}|${f}|${n.replace('/', '\\/')})$`);
    if (re.test(label)) return label.replace(re, `$1${sex === 'M' ? m : sex === 'F' ? f : n}`);
  }
  return label;
}

function chain(ds: Dataset, from: string, to: string, dist: Map<string, number>): string[] {
  const path = [from];
  let cur = from;
  while (cur !== to) {
    const d = dist.get(cur)!;
    const next = parentsOf(ds, cur).find((p) => dist.get(p.id) === d + 1 && (p.id === to || ancestorDistances(ds, p.id).has(to)));
    if (!next) break;
    path.push(next.id);
    cur = next.id;
  }
  return path;
}

/** Branch of a person relative to the root: walks down from root's parents. */
export function inferBranch(ds: Dataset, id: string): Person['branch'] {
  const root = ds.settings.rootPersonId;
  if (id === root) return 'self';
  const p = personById(ds, id);
  if (!p) return 'unknown';
  if (p.branch !== 'unknown') return p.branch;
  const dist = ancestorDistances(ds, root);
  const rootParents = parentsOf(ds, root);
  const father = rootParents.find((x) => x.branch === 'paternal');
  const mother = rootParents.find((x) => x.branch === 'maternal');
  const mine = ancestorDistances(ds, id);
  const viaF = father && mine.has(father.id);
  const viaM = mother && mine.has(mother.id);
  if (viaF && viaM) return 'both';
  if (viaF) return 'paternal';
  if (viaM) return 'maternal';
  if (dist.has(id)) return 'unknown';
  return 'unknown';
}
