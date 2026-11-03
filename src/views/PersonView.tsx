import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { childrenOf, displayName, formatDate, howRelated, parentsOf, partnersOf, siblingsOf } from '../model/graph';
import { Avatar, ConfidencePill, lifespan } from '../components/PersonBits';
import MediaItem from '../components/MediaItem';
import { resolveDispute, standingOf } from '../model/standing';
import { audit } from '../model/review';
import { StandingPill } from '../components/StandingCard';
import { BackIcon, PenIcon } from '../components/Icons';
import type { Person } from '../model/types';

// A person's page is an exhibit: portrait, who they are to the viewer, the story, then the life
// in order. Everything else (sources, questions, submissions, the pencil-and-pen record) opens on
// demand so the page stays calm even when a lot is known.
export default function PersonView() {
  const { id } = useParams();
  const { ds, update, backend } = useStore();
  const p = ds.people.find((x) => x.id === id);
  const [portrait, setPortrait] = useState<string | null>(null);
  const photo = p ? ds.media.find((m) => m.kind === 'photo' && m.personIds.includes(p.id)) : undefined;
  useEffect(() => { let on = true; setPortrait(null); if (photo) backend.mediaUrl(photo).then((u) => { if (on) setPortrait(u); }); return () => { on = false; }; }, [photo, backend]);
  if (!p) return <main className="page empty">No such person.</main>;
  const standing = standingOf(ds, p.id);
  const root = ds.people.find((x) => x.id === ds.settings.rootPersonId)!;
  const relation = p.id === root.id ? 'the starting person of this archive' : howRelated(ds, p.id, root.id).label;
  const events = ds.events.filter((e) => e.personIds.includes(p.id)).sort((a, b) => (a.date?.year ?? 0) - (b.date?.year ?? 0));
  const media = ds.media.filter((m) => m.personIds.includes(p.id));
  const questions = ds.questions.filter((q) => q.personIds.includes(p.id) && q.status !== 'answered');
  const contributions = ds.contributions.filter((c) => c.subject.type === 'person' && c.subject.id === p.id);
  const places = [...new Set(events.map((e) => e.placeId).filter(Boolean))].map((pid) => ds.places.find((pl) => pl.id === pid)!).filter(Boolean);
  const sourcesUsed = [...new Set(events.flatMap((e) => e.sourceIds))].map((sid) => ds.sources.find((s) => s.id === sid)!).filter(Boolean);
  const attestations = (ds.attestations ?? []).filter((a) => a.personId === p.id).sort((a, b) => b.at.localeCompare(a.at));
  const rel = (label: string, people: Person[]) => people.length > 0 && (
    <div style={{ marginBottom: 10 }}>
      <div className="muted" style={{ fontSize: '0.84rem', marginBottom: 4 }}>{label}</div>
      <div className="row">{people.map((x) => <Link key={x.id} to={`/person/${x.id}`} className="chip"><Avatar p={x} size="sm" /><span>{displayName(x)}</span></Link>)}</div>
    </div>
  );
  const verb = (t: string) => ({ birth: 'Born', death: 'Died', burial: 'Buried', marriage: 'Married', residence: 'Lived', occupation: 'Worked as', education: 'Studied', military: 'Served', immigration: 'Emigrated', census: 'Counted in the census', other: '' } as Record<string, string>)[t] ?? t;

  return (
    <main className="page narrow">
      <p style={{ marginBottom: 14 }}><Link to="/tree" className="btn small ghost"><BackIcon />Tree</Link></p>
      <header className="person-head">
        <Avatar p={p} size="lg" src={portrait} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{displayName(p)}</h1>
          <div className="relation">{p.placeholder ? 'A slot waiting on facts' : `${lifespan(ds, p) || 'dates not recorded'} · ${root.givenNames.split(' ')[0]}'s ${relation}`}</div>
          <div className="row"><StandingPill ds={ds} personId={p.id} /><ConfidencePill c={p.confidence} /><span className="pill" style={{ color: `var(--${p.branch === 'both' ? 'gold' : p.branch})` }}>{p.branch === 'both' ? 'both sides' : `${p.branch} side`}</span>{p.privacy === 'private' && <span className="pill">private</span>}</div>
          {p.altNames?.length ? <p className="muted" style={{ marginTop: 8 }}>Also {p.altNames.join(', ')}</p> : null}
        </div>
      </header>

      {p.placeholder ? (
        <div className="banner warn" style={{ marginTop: 18 }}>This is an empty slot. It exists so the tree has a place for this person; nothing about them has been recorded or assumed.</div>
      ) : (
        <section style={{ marginTop: 22 }}>
          <p style={{ fontSize: '1.08rem', lineHeight: 1.6, maxWidth: '62ch' }}>{p.bio ?? <span className="muted">No story written yet. It gets written from documented facts, with interpretation kept separate.</span>}</p>
          {p.occupations?.length ? <p className="muted">{p.occupations.join(' · ')}</p> : null}
        </section>
      )}

      <section className="card raised" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Know something about {p.placeholder ? 'this person' : p.givenNames.split(' ')[0]}?</h3></div>
        <p className="muted" style={{ margin: '6px 0 10px' }}>A memory, a correction, a photo, where they lived. {standing.summary}</p>
        <div className="row"><Link to={`/admin/people?edit=${p.id}`} className="btn primary"><PenIcon />Edit the record</Link><Link to="/admin/invites" className="btn">Invite a relative who knew them</Link></div>
      </section>

      <div className="section-title"><h2>Life</h2></div>
      {events.length === 0 ? <p className="muted">No dated events recorded yet.</p> : (
        <ul className="events">
          {events.map((e) => (
            <li key={e.id} className={e.confidence === 'verified' || e.confidence === 'likely' ? '' : 'unverified'}>
              <div className="when">{formatDate(e.date) || 'Date unknown'} <span className="muted" style={{ fontWeight: 400 }}>· {verb(e.type)}{e.placeId ? ` in ${ds.places.find((pl) => pl.id === e.placeId)?.name ?? ''}` : ''}</span></div>
              {e.description && <div className="what">{e.description}</div>}
              <div style={{ marginTop: 4 }}><ConfidencePill c={e.confidence} /></div>
            </li>
          ))}
        </ul>
      )}

      <div className="section-title"><h2>Family</h2><Link to={`/related`}>How related?</Link></div>
      <section className="card">
        {rel('Parents', parentsOf(ds, p.id))}
        {rel('Brothers and sisters', siblingsOf(ds, p.id))}
        {partnersOf(ds, p.id).length > 0 && rel(partnersOf(ds, p.id).length > 1 ? 'Partners' : 'Partner', partnersOf(ds, p.id).map((x) => x.person))}
        {rel('Children', childrenOf(ds, p.id))}
        {!parentsOf(ds, p.id).length && !siblingsOf(ds, p.id).length && !partnersOf(ds, p.id).length && !childrenOf(ds, p.id).length && <p className="muted" style={{ margin: 0 }}>No relationships recorded yet.</p>}
      </section>

      {(media.length > 0 || places.length > 0) && (
        <>
          <div className="section-title"><h2>Photos, documents and places</h2>{places.length > 0 && <Link to="/map">Open the map</Link>}</div>
          {places.length > 0 && <p className="muted">{places.map((pl) => pl.name).join(' · ')}</p>}
          {media.length > 0 && <div className="stack">{media.map((m) => <MediaItem key={m.id} m={m} />)}</div>}
        </>
      )}

      <div style={{ marginTop: 26 }}>
        <details className="disclosure">
          <summary>Sources and how sure we are <span className="muted">{sourcesUsed.length} record{sourcesUsed.length === 1 ? '' : 's'}</span></summary>
          {sourcesUsed.length ? sourcesUsed.map((s) => <p key={s.id}><strong>{s.title}</strong><br /><small className="muted">{s.repository}{s.citation ? ` · ${s.citation}` : ''}{s.url ? <> · <a href={s.url} target="_blank" rel="noreferrer">open</a></> : ''} · {s.confidence}</small></p>) : <p className="muted">Nothing cited yet; this record rests on what the family has said.</p>}
        </details>
        <details className="disclosure">
          <summary>Pencil and pen <span className="muted">{attestations.length} voice{attestations.length === 1 ? '' : 's'}</span></summary>
          <p>{standing.summary}</p>
          {attestations.map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <span><strong>{a.byName}</strong> {a.stance === 'confirm' ? 'confirmed' : 'questioned'}{a.field ? ` (${a.field})` : ''}{a.note ? `: ${a.note}` : ''} <small className="muted">{new Date(a.at).toLocaleDateString()}{a.resolvedAt ? ` · settled: ${a.resolution}` : ''}</small></span>
              {a.stance === 'dispute' && !a.resolvedAt && <button className="btn small" onClick={() => { const r = prompt('How was this settled? (kept for the record)'); if (r) update((d) => audit(resolveDispute(d, a.id, r), { actor: 'admin', action: 'resolve-dispute', entity: 'person', entityId: p.id, after: r })); }}>Mark settled</button>}
            </div>
          ))}
        </details>
        <details className="disclosure">
          <summary>Open questions <span className="muted">{(p.openQuestions?.length ?? 0) + questions.length}</span></summary>
          {(p.openQuestions ?? []).map((q) => <div key={q} className="question">{q}</div>)}
          {questions.map((q) => <div key={q.id} className="question">{q.title} <span className="pill">{q.priority}</span></div>)}
          {!(p.openQuestions?.length || questions.length) && <p className="muted">None.</p>}
        </details>
        <details className="disclosure">
          <summary>What relatives have sent in <span className="muted">{contributions.length}</span></summary>
          {contributions.length ? contributions.map((c) => <p key={c.id}><strong>{c.contributorName}</strong> · {c.kind} · <span className="pill">{c.status}</span><br /><small>{c.proposal}</small></p>) : <p className="muted">None yet.</p>}
        </details>
        {p.notes && <details className="disclosure"><summary>Admin notes</summary><p className="muted"><em>{p.notes}</em></p></details>}
      </div>
    </main>
  );
}
