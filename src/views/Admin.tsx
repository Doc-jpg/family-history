import { useState } from 'react';
import { Link, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { waitingCounts } from '../model/activity';
import PersonEditor from '../components/PersonEditor';
import InviteManager from '../components/InviteManager';
import Inbox from '../components/Inbox';
import Requests from '../components/Requests';
import { PersonChip, ConfidencePill } from '../components/PersonBits';
import { toGedcom } from '../model/gedcom';
import { audit, rollbackPerson } from '../model/review';
import { displayName, newId } from '../model/graph';
import type { Dataset, ResearchQuestion } from '../model/types';

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

export default function Admin() {
  const { ds, update, replace, reset, mode } = useStore();
  const tabs = [['people', 'People'], ['invites', 'Invitations'], ['inbox', `Inbox${ds.contributions.filter((c) => c.status === 'new').length ? ` (${ds.contributions.filter((c) => c.status === 'new').length})` : ''}`], ['requests', `Requests${ds.accessRequests.filter((r) => r.status === 'new').length ? ` (${ds.accessRequests.filter((r) => r.status === 'new').length})` : ''}`], ['research', 'Research'], ['audit', 'Audit'], ['data', 'Export & backup'], ['settings', 'Settings']];
  return (
    <main className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 }}>
        <div><h1 style={{ marginBottom: 2 }}>Admin</h1><p className="muted" style={{ margin: 0 }}>Relatives propose; you decide. {mode === 'local' ? 'Local draft: this device only.' : 'Signed in to the family database.'}</p></div>
      </div>
      <AdminAttention />
      <nav className="tabs" aria-label="Admin sections">{tabs.map(([k, l]) => <NavLink key={k} to={`/admin/${k}`} className={({ isActive }) => (isActive ? 'active' : '')}>{l}</NavLink>)}</nav>
      <Routes>
        <Route index element={<People />} />
        <Route path="people" element={<People />} />
        <Route path="invites" element={<InviteManager ds={ds} update={update} />} />
        <Route path="inbox" element={<Inbox ds={ds} update={update} />} />
        <Route path="requests" element={<Requests ds={ds} update={update} />} />
        <Route path="research" element={<Research ds={ds} update={update} />} />
        <Route path="audit" element={<Audit ds={ds} update={update} />} />
        <Route path="data" element={<DataTab ds={ds} replace={replace} reset={reset} />} />
        <Route path="settings" element={<SettingsTab ds={ds} update={update} />} />
      </Routes>
    </main>
  );
}

/** What needs the admin's attention right now, one glance. */
function AdminAttention() {
  const { ds } = useStore();
  const w = waitingCounts(ds);
  const items: { n: number; label: string; to: string; hot: boolean }[] = [
    { n: w.inbox, label: 'submissions to review', to: '/admin/inbox', hot: w.inbox > 0 },
    { n: w.disputes, label: 'records under question', to: '/admin/inbox', hot: w.disputes > 0 },
    { n: w.requests, label: 'people asking for a link', to: '/admin/requests', hot: w.requests > 0 },
    { n: w.unopened, label: 'links not opened yet', to: '/admin/invites', hot: false },
    { n: ds.questions.filter((q) => q.status === 'open').length, label: 'open research questions', to: '/admin/research', hot: false },
    { n: ds.people.filter((p) => p.placeholder).length, label: 'slots with no name', to: '/admin/people', hot: false },
  ];
  return <div className="attention">{items.map((i) => <Link key={i.label} to={i.to} className={i.hot ? 'hot' : ''}><strong>{i.n}</strong><span>{i.label}</span></Link>)}</div>;
}

function People() {
  const { ds, update } = useStore();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit');
  const [adding, setAdding] = useState(false);
  const done = () => { setAdding(false); setParams({}); };
  return (
    <div className="stack">
      {!adding && !editing && <div className="row"><button className="btn primary" onClick={() => setAdding(true)}>Add a person</button><span className="muted">Fill a slot by editing it; the slot becomes a real person once it has a name.</span></div>}
      {(adding || editing) && <PersonEditor ds={ds} personId={editing ?? undefined} onSave={update} onDone={done} />}
      <table className="list">
        <thead><tr><th>Person</th><th>Branch</th><th>Gen</th><th>Confidence</th><th>Privacy</th><th></th></tr></thead>
        <tbody>
          {[...ds.people].sort((a, b) => b.generation - a.generation || a.branch.localeCompare(b.branch)).map((p) => (
            <tr key={p.id}>
              <td><PersonChip ds={ds} p={p} />{p.placeholder && <small className="muted"> (slot)</small>}</td>
              <td>{p.branch}</td><td>{p.generation}</td><td><ConfidencePill c={p.confidence} /></td><td>{p.privacy}</td>
              <td><button className="btn small" onClick={() => setParams({ edit: p.id })}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Research({ ds, update }: { ds: Dataset; update: (fn: (d: Dataset) => Dataset) => void }) {
  const [title, setTitle] = useState('');
  const add = () => { if (!title.trim()) return; update((d) => ({ ...d, questions: [{ id: newId('q'), title: title.trim(), personIds: [], status: 'open', priority: 'normal', createdAt: new Date().toISOString() } as ResearchQuestion, ...d.questions] })); setTitle(''); };
  const setQ = (id: string, patch: Partial<ResearchQuestion>) => update((d) => ({ ...d, questions: d.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  return (
    <div className="stack">
      <div className="row"><input style={{ flex: 1, padding: 8 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New research question" /><button className="btn primary" onClick={add}>Add</button></div>
      <table className="list">
        <thead><tr><th>Question</th><th>About</th><th>Priority</th><th>Status</th></tr></thead>
        <tbody>{ds.questions.map((q) => (
          <tr key={q.id}>
            <td>{q.title}{q.notes && <><br /><small className="muted">{q.notes}</small></>}</td>
            <td><small>{q.personIds.map((id) => displayName(ds.people.find((p) => p.id === id)!)).join(', ')}</small></td>
            <td><select value={q.priority} onChange={(e) => setQ(q.id, { priority: e.target.value as ResearchQuestion['priority'] })}><option>high</option><option>normal</option><option>low</option></select></td>
            <td><select value={q.status} onChange={(e) => setQ(q.id, { status: e.target.value as ResearchQuestion['status'] })}><option value="open">open</option><option value="in-progress">in progress</option><option value="answered">answered</option><option value="parked">parked</option></select></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="card"><h3>Sources on file ({ds.sources.length})</h3>{ds.sources.map((s) => <div key={s.id}><strong>{s.title}</strong> <small className="muted">{s.repository} · {s.confidence}{s.accessedOn ? ` · ${s.accessedOn}` : ''}</small></div>)}</div>
    </div>
  );
}

function Audit({ ds, update }: { ds: Dataset; update: (fn: (d: Dataset) => Dataset) => void }) {
  return (
    <table className="list">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th></th></tr></thead>
      <tbody>{ds.audit.map((a) => (
        <tr key={a.id}>
          <td><small>{new Date(a.at).toLocaleString()}</small></td><td>{a.actor}</td><td>{a.action}</td>
          <td>{a.entity}{a.entityId ? ` · ${a.entityId}` : ''}{a.before && a.entity === 'person' ? <details><summary><small>previous version</small></summary><pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{JSON.stringify(a.before, null, 1)}</pre></details> : null}</td>
          <td>{a.entity === 'person' && a.before && (a.action === 'edit-person' || a.action === 'apply-correction') ? <button className="btn small" onClick={() => update((d) => rollbackPerson(d, a.id, 'admin'))}>Roll back</button> : null}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function DataTab({ ds, replace, reset }: { ds: Dataset; replace: (d: Dataset) => void; reset: () => void }) {
  const [msg, setMsg] = useState('');
  const stamp = new Date().toISOString().slice(0, 10);
  const importJson = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as Dataset;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.people)) throw new Error('not a family-history backup');
      replace(parsed);
      setMsg(`Restored ${parsed.people.length} people from ${f.name}.`);
    } catch (e) { setMsg(`Could not import: ${(e as Error).message}`); }
  };
  return (
    <div className="stack">
      <div className="card"><h3>Backup (everything, including invitations and audit)</h3><p className="muted">Full JSON. Keep copies somewhere safe; this is the file that restores the archive.</p><button className="btn primary" onClick={() => download(`family-history-backup-${stamp}.json`, JSON.stringify(ds, null, 2))}>Download backup</button></div>
      <div className="card"><h3>GEDCOM (for Ancestry, FamilySearch, Gramps, any genealogy program)</h3><p className="muted">Named people only; empty slots are skipped. Private people are left out unless you tick the box.</p><div className="row"><button className="btn" onClick={() => download(`family-history-${stamp}.ged`, toGedcom(ds), 'text/plain')}>Export GEDCOM</button><button className="btn" onClick={() => download(`family-history-with-private-${stamp}.ged`, toGedcom(ds, { includePrivate: true }), 'text/plain')}>Export including private people</button></div></div>
      <div className="card"><h3>Restore from a backup</h3><input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />{msg && <p>{msg}</p>}</div>
      <div className="card"><h3>Start over</h3><p className="muted">Resets this browser's copy to the empty seed (one root person plus empty slots). Download a backup first.</p><button className="btn danger" onClick={() => { if (confirm('Reset this browser to the seed data? Download a backup first.')) reset(); }}>Reset to seed</button></div>
    </div>
  );
}

function SettingsTab({ ds, update }: { ds: Dataset; update: (fn: (d: Dataset) => Dataset) => void }) {
  const s = ds.settings;
  const set = (patch: Partial<Dataset['settings']>) => update((d) => audit({ ...d, settings: { ...d.settings, ...patch } }, { actor: 'admin', action: 'settings', entity: 'settings', after: patch }));
  return (
    <div className="card">
      <h3>Appearance</h3>
      <div className="form-grid">
        <label className="field">Family name on the masthead<input value={s.familyName} onChange={(e) => set({ familyName: e.target.value })} /></label>
        <label className="field">Theme<select value={s.theme} onChange={(e) => set({ theme: e.target.value as Dataset['settings']['theme'] })}><option value="parchment">Field (default)</option><option value="linen">Brighter</option><option value="ink">Night (dark)</option></select></label>
        {(['paternal', 'maternal', 'self', 'household', 'unknown'] as const).map((k) => <label key={k} className="field">{k} color<input type="color" value={s.colors[k]} onChange={(e) => set({ colors: { ...s.colors, [k]: e.target.value } })} /></label>)}
      </div>
    </div>
  );
}
