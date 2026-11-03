import { useEffect, useState } from 'react';
import type { Dataset, Person, Place } from '../model/types';
import { displayName, newId, parseDate, parentsOf, partnersOf } from '../model/graph';
import { audit } from '../model/review';

interface Props { ds: Dataset; personId?: string; onSave: (fn: (ds: Dataset) => Dataset) => void; onDone: () => void }

const empty = (): Person => ({ id: newId('p'), givenNames: '', surname: '', living: 'unknown', branch: 'unknown', generation: 1, confidence: 'tentative', placeholder: false, privacy: 'family', updatedAt: new Date().toISOString() });

export default function PersonEditor({ ds, personId, onSave, onDone }: Props) {
  const existing = personId ? ds.people.find((p) => p.id === personId) : undefined;
  const [p, setP] = useState<Person>(existing ?? empty());
  const birth = ds.events.find((e) => e.type === 'birth' && e.personIds.includes(p.id));
  const death = ds.events.find((e) => e.type === 'death' && e.personIds.includes(p.id));
  const [birthDate, setBirthDate] = useState(birth?.date?.text ?? (birth?.date?.year ? [birth.date.year, birth.date.month, birth.date.day].filter(Boolean).join('-') : ''));
  const [birthPlace, setBirthPlace] = useState(ds.places.find((pl) => pl.id === birth?.placeId)?.name ?? '');
  const [deathDate, setDeathDate] = useState(death?.date?.text ?? (death?.date?.year ? [death.date.year, death.date.month, death.date.day].filter(Boolean).join('-') : ''));
  const [deathPlace, setDeathPlace] = useState(ds.places.find((pl) => pl.id === death?.placeId)?.name ?? '');
  const [sourceNote, setSourceNote] = useState('');
  const [parentIds, setParentIds] = useState<string[]>(existing ? parentsOf(ds, existing.id).map((x) => x.id) : []);
  const [partnerIds, setPartnerIds] = useState<string[]>(existing ? partnersOf(ds, existing.id).map((x) => x.person.id) : []);
  useEffect(() => { if (existing) setP(existing); }, [existing]);

  const set = <K extends keyof Person>(k: K, v: Person[K]) => setP((x) => ({ ...x, [k]: v }));

  function placeFor(name: string, ds2: Dataset): { ds: Dataset; id?: string } {
    const n = name.trim();
    if (!n) return { ds: ds2 };
    const found = ds2.places.find((pl) => pl.name.toLowerCase() === n.toLowerCase());
    if (found) return { ds: ds2, id: found.id };
    const pl: Place = { id: newId('pl'), name: n };
    return { ds: { ...ds2, places: [...ds2.places, pl] }, id: pl.id };
  }

  function save() {
    onSave((d0) => {
      const before = d0.people.find((x) => x.id === p.id);
      const person: Person = { ...p, placeholder: false, updatedAt: new Date().toISOString() };
      let d = { ...d0, people: before ? d0.people.map((x) => (x.id === p.id ? person : x)) : [...d0.people, person] };
      let sourceId: string | undefined;
      if (sourceNote.trim()) {
        sourceId = newId('s');
        d = { ...d, sources: [...d.sources, { id: sourceId, title: sourceNote.trim(), repository: 'Entered by admin', accessedOn: new Date().toISOString().slice(0, 10), confidence: person.confidence }] };
      }
      const upsertEvent = (type: 'birth' | 'death', dateStr: string, placeName: string) => {
        const date = parseDate(dateStr);
        const pr = placeFor(placeName, d);
        d = pr.ds;
        if (!date && !pr.id) { d = { ...d, events: d.events.filter((e) => !(e.type === type && e.personIds.includes(person.id))) }; return; }
        const ex = d.events.find((e) => e.type === type && e.personIds.includes(person.id));
        const ev = { id: ex?.id ?? newId('e'), type, personIds: [person.id], date, placeId: pr.id, sourceIds: [...(ex?.sourceIds ?? []), ...(sourceId ? [sourceId] : [])], confidence: person.confidence, description: ex?.description };
        d = { ...d, events: ex ? d.events.map((e) => (e.id === ex.id ? ev : e)) : [...d.events, ev] };
      };
      upsertEvent('birth', birthDate, birthPlace);
      upsertEvent('death', deathDate, deathPlace);
      // relationships
      const keepRel = d.relationships.filter((r) => !((r.type === 'parent-child' && r.toId === person.id) || (r.type === 'partner' && (r.fromId === person.id || r.toId === person.id))));
      const newRels = [
        ...parentIds.map((pid) => d.relationships.find((r) => r.type === 'parent-child' && r.fromId === pid && r.toId === person.id) ?? { id: newId('r'), type: 'parent-child' as const, fromId: pid, toId: person.id, status: 'unverified' as const, sourceIds: sourceId ? [sourceId] : [] }),
        ...partnerIds.map((pid) => d.relationships.find((r) => r.type === 'partner' && ((r.fromId === pid && r.toId === person.id) || (r.toId === pid && r.fromId === person.id))) ?? { id: newId('r'), type: 'partner' as const, fromId: person.id, toId: pid, subtype: 'marriage' as const, status: 'unverified' as const, sourceIds: sourceId ? [sourceId] : [] }),
      ];
      d = { ...d, relationships: [...keepRel, ...newRels] };
      return audit(d, { actor: 'admin', action: before ? 'edit-person' : 'add-person', entity: 'person', entityId: person.id, before, after: person });
    });
    onDone();
  }

  const others = ds.people.filter((x) => x.id !== p.id);
  return (
    <div className="card">
      <h3>{existing ? `Edit ${displayName(existing)}` : 'Add a person'}</h3>
      <div className="form-grid">
        <label className="field">Given names<input value={p.givenNames} onChange={(e) => set('givenNames', e.target.value)} placeholder="e.g. Mary Ellen" /></label>
        <label className="field">Surname<input value={p.surname} onChange={(e) => set('surname', e.target.value)} /></label>
        <label className="field">Maiden name<input value={p.maidenName ?? ''} onChange={(e) => set('maidenName', e.target.value || undefined)} /></label>
        <label className="field">Sex<select value={p.sex ?? ''} onChange={(e) => set('sex', (e.target.value || undefined) as Person['sex'])}><option value="">unknown</option><option value="M">M</option><option value="F">F</option><option value="X">X</option></select></label>
        <label className="field">Living?<select value={p.living} onChange={(e) => set('living', e.target.value as Person['living'])}><option value="yes">living</option><option value="no">deceased</option><option value="unknown">unknown</option></select></label>
        <label className="field">Branch<select value={p.branch} onChange={(e) => set('branch', e.target.value as Person['branch'])}><option value="paternal">paternal</option><option value="maternal">maternal</option><option value="both">both</option><option value="household">household</option><option value="self">self</option><option value="unknown">unknown</option></select></label>
        <label className="field">Generation (0 = the root person, 1 = parents, -1 = children)<input type="number" value={p.generation} onChange={(e) => set('generation', +e.target.value)} /></label>
        <label className="field">Confidence<select value={p.confidence} onChange={(e) => set('confidence', e.target.value as Person['confidence'])}><option value="verified">verified</option><option value="likely">likely</option><option value="tentative">tentative</option><option value="unresearched">unresearched</option></select></label>
        <label className="field">Privacy<select value={p.privacy} onChange={(e) => set('privacy', e.target.value as Person['privacy'])}><option value="family">family (invited relatives may see)</option><option value="private">private (admin only)</option><option value="shareable">shareable</option></select></label>
        <label className="field">Birth date (YYYY, YYYY-MM-DD, "about 1902")<input value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></label>
        <label className="field">Birth place<input value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="City, State, Country" /></label>
        <label className="field">Death date<input value={deathDate} onChange={(e) => setDeathDate(e.target.value)} /></label>
        <label className="field">Death place<input value={deathPlace} onChange={(e) => setDeathPlace(e.target.value)} /></label>
        <label className="field">Parents<select multiple value={parentIds} onChange={(e) => setParentIds([...e.target.selectedOptions].map((o) => o.value))} size={4}>{others.map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}</select></label>
        <label className="field">Partners<select multiple value={partnerIds} onChange={(e) => setPartnerIds([...e.target.selectedOptions].map((o) => o.value))} size={4}>{others.map((x) => <option key={x.id} value={x.id}>{displayName(x)}</option>)}</select></label>
      </div>
      <label className="field" style={{ marginTop: 10 }}>Biography<textarea value={p.bio ?? ''} onChange={(e) => set('bio', e.target.value || undefined)} /></label>
      <label className="field" style={{ marginTop: 10 }}>Occupations (comma separated)<input value={(p.occupations ?? []).join(', ')} onChange={(e) => set('occupations', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></label>
      <label className="field" style={{ marginTop: 10 }}>Where did this come from? (becomes a source record)<input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder='e.g. "Told by Mom, Nov 2026" or "1940 census, FamilySearch, link"' /></label>
      <label className="field" style={{ marginTop: 10 }}>Admin notes<textarea value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} /></label>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={save} disabled={!p.givenNames.trim() && !p.surname.trim()}>Save</button>
        <button className="btn" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
