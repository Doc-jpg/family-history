import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { childrenOf, displayName, formatDate, parentsOf, partnersOf, siblingsOf } from '../model/graph';
import { branchColor, ConfidencePill, PersonChip, lifespan } from '../components/PersonBits';
import MediaItem from '../components/MediaItem';

export default function PersonView() {
  const { id } = useParams();
  const { ds } = useStore();
  const p = ds.people.find((x) => x.id === id);
  if (!p) return <main className="page empty">No such person.</main>;
  const events = ds.events.filter((e) => e.personIds.includes(p.id)).sort((a, b) => (a.date?.year ?? 0) - (b.date?.year ?? 0));
  const media = ds.media.filter((m) => m.personIds.includes(p.id));
  const questions = ds.questions.filter((q) => q.personIds.includes(p.id) && q.status !== 'answered');
  const contributions = ds.contributions.filter((c) => c.subject.type === 'person' && c.subject.id === p.id);
  const places = [...new Set(events.map((e) => e.placeId).filter(Boolean))].map((pid) => ds.places.find((pl) => pl.id === pid)!).filter(Boolean);
  const sourcesUsed = [...new Set(events.flatMap((e) => e.sourceIds))].map((sid) => ds.sources.find((s) => s.id === sid)!).filter(Boolean);

  return (
    <main className="page">
      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--paper-2)', border: `4px solid ${branchColor(p.branch)}`, display: 'grid', placeItems: 'center', fontFamily: 'var(--serif)', fontSize: 34, flexShrink: 0, borderStyle: p.placeholder ? 'dashed' : 'solid' }}>
          {p.placeholder ? '?' : p.givenNames.slice(0, 1)}
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ marginBottom: 4 }}>{displayName(p)}</h1>
          <p className="row">
            <ConfidencePill c={p.confidence} />
            <span className="pill">{p.branch} branch</span>
            <span className="pill">{p.living === 'yes' ? 'living' : p.living === 'no' ? 'deceased' : 'living status unknown'}</span>
            <span className="pill">{lifespan(ds, p) || 'no dates'}</span>
            <span className="pill">{p.privacy}</span>
          </p>
          {p.altNames?.length ? <p className="muted">Also known as: {p.altNames.join(', ')}</p> : null}
          {p.placeholder && <div className="banner warn">This is an empty slot. It exists so the tree has a place for this person; nothing about them has been recorded or assumed.</div>}
          <p>{p.bio ?? <span className="muted">No biography yet. It gets written from documented facts, with interpretation kept separate.</span>}</p>
          {p.notes && <p className="muted"><em>{p.notes}</em></p>}
        </div>
      </div>

      <section className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h3>Family</h3>
          <dl className="kv">
            <dt>Parents</dt><dd className="stack">{parentsOf(ds, p.id).map((x) => <PersonChip key={x.id} ds={ds} p={x} />)}{!parentsOf(ds, p.id).length && '—'}</dd>
            <dt>Siblings</dt><dd className="stack">{siblingsOf(ds, p.id).map((x) => <PersonChip key={x.id} ds={ds} p={x} />)}{!siblingsOf(ds, p.id).length && '—'}</dd>
            <dt>Partners</dt><dd className="stack">{partnersOf(ds, p.id).map((x) => <span key={x.person.id} className="row"><PersonChip ds={ds} p={x.person} /><span className={`pill ${x.rel.status === 'verified' ? 'ok' : x.rel.status === 'disputed' ? 'bad' : 'warn'}`}>{x.rel.status}</span></span>)}{!partnersOf(ds, p.id).length && '—'}</dd>
            <dt>Children</dt><dd className="stack">{childrenOf(ds, p.id).map((x) => <PersonChip key={x.id} ds={ds} p={x} />)}{!childrenOf(ds, p.id).length && '—'}</dd>
          </dl>
        </div>
        <div className="card span2">
          <h3>Life events</h3>
          {events.length === 0 && <p className="muted">None recorded.</p>}
          <table className="list">
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><strong>{e.type}</strong></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.date) || <span className="muted">date unknown</span>}</td>
                  <td>{ds.places.find((pl) => pl.id === e.placeId)?.name ?? ''}<br /><small className="muted">{e.description}</small></td>
                  <td><ConfidencePill c={e.confidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.occupations?.length ? <p><strong>Occupations:</strong> {p.occupations.join(', ')}</p> : null}
        </div>
        <div className="card">
          <h3>Places</h3>
          {places.length ? places.map((pl) => <div key={pl.id}>{pl.name}{pl.lat == null && <small className="muted"> (not yet on the map)</small>}</div>) : <p className="muted">No places yet.</p>}
          <Link to="/map" className="btn small" style={{ marginTop: 8 }}>Open map</Link>
        </div>
        <div className="card">
          <h3>Sources and confidence</h3>
          {sourcesUsed.length ? sourcesUsed.map((s) => <div key={s.id}><strong>{s.title}</strong><br /><small className="muted">{s.repository}{s.citation ? ` · ${s.citation}` : ''}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">link</a></> : null}{s.accessedOn ? ` · accessed ${s.accessedOn}` : ''}</small></div>) : <p className="muted">No sources attached yet. Facts without a source stay marked as unverified.</p>}
        </div>
        <div className="card">
          <h3>Photos and documents</h3>
          {media.length ? <div className="stack">{media.map((m) => <MediaItem key={m.id} m={m} />)}</div> : <p className="muted">Nothing uploaded yet.</p>}
        </div>
        <div className="card">
          <h3>Open questions</h3>
          {(p.openQuestions ?? []).map((q) => <div key={q} className="question">{q}</div>)}
          {questions.map((q) => <div key={q.id} className="question">{q.title} <span className="pill">{q.priority}</span></div>)}
          {!(p.openQuestions?.length || questions.length) && <p className="muted">None.</p>}
        </div>
        <div className="card">
          <h3>Contributions about this person</h3>
          {contributions.length ? contributions.map((c) => <div key={c.id}><strong>{c.contributorName}</strong> · {c.kind} · <span className="pill">{c.status}</span><br /><small>{c.proposal}</small></div>) : <p className="muted">None yet.</p>}
        </div>
      </section>
      <p style={{ marginTop: 20 }}><Link to={`/admin/people?edit=${p.id}`} className="btn">Edit this person</Link> <Link to="/tree" className="btn">Back to tree</Link></p>
    </main>
  );
}
