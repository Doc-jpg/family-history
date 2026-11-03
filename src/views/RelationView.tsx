import { useState } from 'react';
import { useStore } from '../store/store';
import { displayName, howRelated } from '../model/graph';
import { PersonChip } from '../components/PersonBits';

export default function RelationView() {
  const { ds } = useStore();
  const people = ds.people.filter((p) => !p.placeholder);
  const [a, setA] = useState(ds.settings.rootPersonId);
  const [b, setB] = useState(people.find((p) => p.id !== ds.settings.rootPersonId)?.id ?? ds.settings.rootPersonId);
  const r = howRelated(ds, a, b);
  const pa = ds.people.find((p) => p.id === a)!, pb = ds.people.find((p) => p.id === b)!;
  return (
    <main className="page">
      <h1>How are we related?</h1>
      <p className="muted">Pick two people. The answer follows parent-child links, so it is only as complete as the tree.</p>
      <div className="form-grid" style={{ maxWidth: 700 }}>
        <label className="field">First person<select value={a} onChange={(e) => setA(e.target.value)}>{ds.people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}</select></label>
        <label className="field">Second person<select value={b} onChange={(e) => setB(e.target.value)}>{ds.people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}</select></label>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h2>{displayName(pa)} is {pb ? displayName(pb) : ''}'s <span style={{ color: 'var(--accent)' }}>{r.label}</span></h2>
        {r.path.length > 1 && (
          <div className="row" style={{ marginTop: 10 }}>
            {r.path.map((id, i) => { const p = ds.people.find((x) => x.id === id)!; return <span key={id} className="row">{i > 0 && <span className="muted">→</span>}<PersonChip ds={ds} p={p} /></span>; })}
          </div>
        )}
        {r.commonAncestorIds.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Shared ancestor{r.commonAncestorIds.length > 1 ? 's' : ''}: {r.commonAncestorIds.map((id) => displayName(ds.people.find((p) => p.id === id)!)).join(' and ')}</p>}
        {r.path.some((id) => ds.people.find((p) => p.id === id)?.placeholder) && <p className="muted">This path runs through an unnamed slot, so it is a structural guess, not a confirmed relationship.</p>}
      </div>
    </main>
  );
}
