import type { Dataset, Person, ContributionKind } from './types';
import { ancestorDistances, displayName, howRelated, parentsOf, partnersOf } from './graph';

// Everything a relative sees is framed from where THEY stand in the tree: their parents and
// grandparents, their children, their siblings, labeled as "your mother", "your grandson",
// and a short list of the blanks on their side that they are the best person to fill.
// Pure functions over an already-redacted dataset.

export interface RelativeEntry { person: Person; label: string; distance: number }
export interface RelativeGroup { title: string; entries: RelativeEntry[] }

const GROUP_ORDER = ['Your parents and grandparents', 'Your partner, children and grandchildren', 'Your brothers and sisters, nieces and nephews', 'Your aunts, uncles and cousins', 'Related by marriage', 'Elsewhere in the family'] as const;

function groupFor(label: string): (typeof GROUP_ORDER)[number] {
  if (/in-law/.test(label)) return 'Related by marriage';
  if (/^(mother|father|parent|.*grand(mother|father|parent))$/.test(label)) return 'Your parents and grandparents';
  if (/^(spouse|partner|son|daughter|child|.*grand(son|daughter|child))$/.test(label)) return 'Your partner, children and grandchildren';
  if (/(sister|brother|sibling|niece|nephew)/.test(label)) return 'Your brothers and sisters, nieces and nephews';
  if (/(aunt|uncle|cousin)/.test(label)) return 'Your aunts, uncles and cousins';
  return 'Elsewhere in the family';
}

/** Everyone visible, grouped and labeled from `meId`'s point of view, closest first. */
export function relativesOf(ds: Dataset, meId: string): RelativeGroup[] {
  const me = ds.people.find((p) => p.id === meId);
  if (!me) return [];
  const up = ancestorDistances(ds, meId);
  const entries: RelativeEntry[] = [];
  for (const p of ds.people) {
    if (p.id === meId || p.placeholder) continue;
    const r = howRelated(ds, p.id, meId);
    if (r.label === 'unknown') continue;
    const dist = r.path.length ? r.path.length - 1 : 99;
    entries.push({ person: p, label: r.label === 'no known connection yet' ? 'connection not recorded yet' : r.label, distance: up.get(p.id) ?? dist });
  }
  const groups = new Map<string, RelativeEntry[]>();
  for (const e of entries) {
    const g = e.label === 'connection not recorded yet' ? 'Elsewhere in the family' : groupFor(e.label);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(e);
  }
  return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ title: g, entries: groups.get(g)!.sort((a, b) => a.distance - b.distance || displayName(a.person).localeCompare(displayName(b.person))) }));
}

export interface Gap { id: string; personId: string; personName: string; question: string; kind: ContributionKind; priority: number }

/** The blanks on this person's own side of the family that they are best placed to fill. Closest people first; at most `limit`. */
export function gapsFor(ds: Dataset, meId: string, limit = 24): Gap[] {
  const me = ds.people.find((p) => p.id === meId);
  if (!me) return [];
  const up = ancestorDistances(ds, meId);
  // Only their own blood line: themselves and their ancestors. A spouse's side belongs to the spouse's own invitation.
  const mine = [...new Set([meId, ...up.keys()])];
  const gaps: Gap[] = [];
  const first = (p: Person) => (p.id === meId ? 'you' : p.altNames?.find((n) => !n.includes(' ')) ?? p.givenNames.split(' ')[0]);
  const poss = (p: Person) => (p.id === meId ? 'your' : `${first(p)}'s`);
  const has = (p: Person, k: NonNullable<Person['recorded']>[number]) => {
    if (p.recorded) return p.recorded.includes(k);
    const ev = ds.events.filter((e) => e.personIds.includes(p.id));
    switch (k) {
      case 'parents': return parentsOf(ds, p.id).filter((x) => !x.placeholder).length >= 2;
      case 'birth': { const b = ev.find((e) => e.type === 'birth'); return !!(b && b.date?.year); }
      case 'death': return ev.some((e) => e.type === 'death');
      case 'residence': return ev.some((e) => e.type === 'residence');
      case 'occupation': return ev.some((e) => e.type === 'occupation');
      case 'photo': return ds.media.some((m) => m.kind === 'photo' && m.personIds.includes(p.id));
      case 'bio': return !!p.bio;
      case 'maidenName': return !!p.maidenName;
    }
  };
  for (const id of mine) {
    const p = ds.people.find((x) => x.id === id);
    if (!p || p.placeholder) continue;
    const d = id === meId ? 0 : (up.get(id) ?? 1);
    const base = d * 10;
    const add = (key: string, question: string, kind: ContributionKind, prio: number) => gaps.push({ id: `g-${key}-${id}`, personId: id, personName: displayName(p), question, kind, priority: base + prio });
    if (!has(p, 'parents') && d <= 3) add('parents', parentsOf(ds, id).filter((x) => !x.placeholder).length === 0 ? `Who were ${poss(p)} parents?` : `Who was ${poss(p)} other parent?`, 'missing-person', 1);
    if (!has(p, 'birth')) add('birth', id === meId ? 'When and where were you born? (Only if you want it recorded.)' : `When and where was ${first(p)} born?`, 'correction', 2);
    if (p.living === 'no' && !has(p, 'death')) add('death', `When and where did ${first(p)} die?`, 'correction', 3);
    if (p.living === 'unknown') add('living', `Is ${first(p)} still living?`, 'correction', 3);
    if (p.sex === 'F' && !has(p, 'maidenName') && d >= 1 && partnersOf(ds, id).length) add('maiden', `What was ${poss(p)} maiden name?`, 'correction', 4);
    if (!has(p, 'residence') && id !== meId) add('res', `Where did ${first(p)} live?`, 'location', 5);
    if (!has(p, 'occupation') && d >= 1 && d <= 2) add('work', `What did ${first(p)} do for a living?`, 'memory', 6);
    if (!has(p, 'bio') && id !== meId) add('story', `What do you remember about ${first(p)}?`, 'memory', 7);
    if (!has(p, 'photo')) add('photo', id === meId ? 'Do you have a photo of yourself you would like in the archive?' : `Do you have a photo of ${first(p)}?`, 'upload', 8);
  }
  if (parentsOf(ds, meId).some((x) => !x.placeholder)) gaps.push({ id: 'g-siblings', personId: meId, personName: displayName(me), question: 'Are all of your brothers and sisters in the tree? Who is missing?', kind: 'missing-person', priority: 9 });

  // One or two steps out (brothers and sisters, children, nieces and nephews, aunts and uncles): the
  // people a relative knows well but the record often has only a first name for.
  const mineSet = new Set(mine);
  for (const p of ds.people) {
    if (p.placeholder || mineSet.has(p.id)) continue;
    const r = howRelated(ds, p.id, meId);
    if (!r.path.length || r.label.includes('in-law') || r.label === 'spouse' || r.label === 'partner') continue;
    const steps = r.path.length - 1;
    if (steps > 3) continue;
    const base = 30 + steps * 10;
    const who = p.givenNames.split(' ')[0];
    const rel = `your ${r.label}`;
    const add = (key: string, question: string, kind: ContributionKind, prio: number) => gaps.push({ id: `g-${key}-${p.id}`, personId: p.id, personName: `${displayName(p)} (${rel})`, question, kind, priority: base + prio });
    if (!p.surname) add('name', `What is ${who}'s full name${p.sex === 'F' ? ' (maiden and married)' : ''}?`, 'correction', 1);
    else if (p.sex === 'F' && !has(p, 'maidenName') && partnersOf(ds, p.id).length) add('maiden', `What was ${who}'s maiden name?`, 'correction', 2);
    if (!has(p, 'birth')) add('birth', `When was ${who} born?`, 'correction', 3);
    if (p.living === 'no' && !has(p, 'death')) add('death', `When did ${who} die?`, 'correction', 3);
    if (steps <= 2 && !partnersOf(ds, p.id).length && p.generation <= 0 + (me.generation)) add('spouse', `Is ${who} married or partnered? To whom?`, 'missing-person', 4);
    if (steps <= 2 && /sister|brother|sibling|son|daughter|child/.test(r.label) && !ds.relationships.some((x) => x.type === 'parent-child' && x.fromId === p.id)) add('kids', `Does ${who} have children we have not listed?`, 'missing-person', 5);
    if (!has(p, 'residence')) add('res', `Where does ${who} live${p.living === 'no' ? ' (or where did they)' : ''}?`, 'location', 6);
  }
  return gaps.sort((a, b) => a.priority - b.priority).slice(0, limit);
}
