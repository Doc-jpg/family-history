import type { Dataset, DateValue, Person } from './types';
import { formatDate } from './graph';

// GEDCOM 5.5.1 export (families built from partner + parent-child relationships).
// Placeholders are skipped; private people are included only when includePrivate is set.

function gedDate(d?: DateValue): string | undefined {
  if (!d) return undefined;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  if (!d.year) return d.text;
  let s = '';
  if (d.day && d.month) s = `${d.day} ${months[d.month - 1]} ${d.year}`;
  else if (d.month) s = `${months[d.month - 1]} ${d.year}`;
  else s = String(d.year);
  return d.approx ? `ABT ${s}` : s;
}

export function toGedcom(ds: Dataset, opts: { includePrivate?: boolean } = {}): string {
  const people = ds.people.filter((p) => !p.placeholder && (opts.includePrivate || p.privacy !== 'private'));
  const ids = new Set(people.map((p) => p.id));
  const xref = new Map<string, string>();
  people.forEach((p, i) => xref.set(p.id, `@I${i + 1}@`));
  const lines: string[] = ['0 HEAD', '1 SOUR FleshFamilyHistory', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];

  // Families: key by sorted partner pair, or single parent.
  const fams = new Map<string, { husb?: string; wife?: string; parents: string[]; children: Set<string>; marr?: DateValue }>();
  const famKey = (parents: string[]) => parents.slice().sort().join('+');
  for (const r of ds.relationships.filter((r) => r.type === 'partner' && ids.has(r.fromId) && ids.has(r.toId))) {
    const key = famKey([r.fromId, r.toId]);
    if (!fams.has(key)) fams.set(key, { parents: [r.fromId, r.toId], children: new Set(), marr: r.start });
  }
  for (const child of people) {
    const parents = ds.relationships.filter((r) => r.type === 'parent-child' && r.toId === child.id && ids.has(r.fromId)).map((r) => r.fromId);
    if (!parents.length) continue;
    let key = famKey(parents);
    if (!fams.has(key)) {
      // Try to find an existing partner family containing these parents.
      const found = [...fams.entries()].find(([, f]) => parents.every((p) => f.parents.includes(p)));
      if (found) key = found[0];
      else fams.set(key, { parents, children: new Set() });
    }
    fams.get(key)!.children.add(child.id);
  }
  const famX = new Map<string, string>();
  [...fams.keys()].forEach((k, i) => famX.set(k, `@F${i + 1}@`));

  const sexOf = (id: string) => people.find((p) => p.id === id)?.sex;
  for (const [key, f] of fams) {
    const h = f.parents.find((p) => sexOf(p) === 'M') ?? f.parents.find((p) => sexOf(p) !== 'F');
    const w = f.parents.find((p) => p !== h);
    f.husb = h;
    f.wife = w;
    void key;
  }

  const eventsFor = (p: Person) => ds.events.filter((e) => e.personIds.includes(p.id));
  for (const p of people) {
    lines.push(`0 ${xref.get(p.id)} INDI`);
    lines.push(`1 NAME ${p.givenNames} /${p.surname}/`);
    if (p.maidenName) lines.push(`1 NAME ${p.givenNames} /${p.maidenName}/`, '2 TYPE maiden');
    if (p.sex && p.sex !== 'X') lines.push(`1 SEX ${p.sex}`);
    for (const e of eventsFor(p)) {
      const tag = { birth: 'BIRT', death: 'DEAT', burial: 'BURI', residence: 'RESI', immigration: 'IMMI', naturalization: 'NATU', military: 'EVEN', occupation: 'OCCU', education: 'EDUC', census: 'CENS', marriage: undefined, divorce: undefined, other: 'EVEN' }[e.type];
      if (!tag) continue;
      lines.push(`1 ${tag}${e.type === 'occupation' && e.description ? ' ' + e.description : ''}`);
      const d = gedDate(e.date);
      if (d) lines.push(`2 DATE ${d}`);
      const place = ds.places.find((pl) => pl.id === e.placeId);
      if (place) lines.push(`2 PLAC ${place.name}`);
      if (e.description && e.type !== 'occupation') lines.push(`2 NOTE ${e.description}`);
      for (const sid of e.sourceIds) lines.push(`2 SOUR @S${sid}@`);
    }
    for (const [key, f] of fams) {
      if (f.parents.includes(p.id)) lines.push(`1 FAMS ${famX.get(key)}`);
      if (f.children.has(p.id)) lines.push(`1 FAMC ${famX.get(key)}`);
    }
    if (p.bio) lines.push(`1 NOTE ${p.bio}`);
    lines.push(`1 CHAN`, `2 DATE ${new Date(p.updatedAt).toUTCString().slice(5, 16).toUpperCase()}`);
  }
  for (const [key, f] of fams) {
    lines.push(`0 ${famX.get(key)} FAM`);
    if (f.husb) lines.push(`1 HUSB ${xref.get(f.husb)}`);
    if (f.wife) lines.push(`1 WIFE ${xref.get(f.wife)}`);
    for (const c of f.children) lines.push(`1 CHIL ${xref.get(c)}`);
    const m = gedDate(f.marr);
    if (m) lines.push('1 MARR', `2 DATE ${m}`);
  }
  for (const s of ds.sources) {
    lines.push(`0 @S${s.id}@ SOUR`, `1 TITL ${s.title}`);
    if (s.repository) lines.push(`1 REPO ${s.repository}`);
    if (s.citation) lines.push(`1 TEXT ${s.citation}`);
    if (s.url) lines.push(`1 NOTE ${s.url}`);
  }
  lines.push('0 TRLR');
  void formatDate;
  return lines.join('\n') + '\n';
}
