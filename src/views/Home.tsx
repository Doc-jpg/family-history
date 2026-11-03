import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { PersonChip } from '../components/PersonBits';
import { birthYear, personById } from '../model/graph';
import Constellation from '../components/Constellation';
import { activityFeed, timeAgo, waitingCounts } from '../model/activity';

export default function Home() {
  const { ds, mode } = useStore();
  const real = ds.people.filter((p) => !p.placeholder);
  const slots = ds.people.filter((p) => p.placeholder);
  const root = personById(ds, ds.settings.rootPersonId)!;
  const openQ = ds.questions.filter((q) => q.status === 'open');
  const sourced = ds.events.filter((e) => e.sourceIds.length).length;
  const gens = new Set(real.map((p) => p.generation)).size;
  const years = real.map((p) => birthYear(ds, p.id)).filter((y): y is number => !!y);
  const earliest = years.length ? Math.min(...years) : undefined;
  // The surnames that carry the most people, for the headline.
  const counts = new Map<string, number>();
  for (const p of real) for (const n of [p.surname, p.maidenName]) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const feed = activityFeed(ds, 12);
  const waiting = waitingCounts(ds);

  return (
    <main className="page">
      <section className="band">
        <h1>One family, {gens} generations{earliest ? `, ${earliest} to today` : ''}.</h1>
        <p>The {names.length ? <span className="names">{names.slice(0, -1).join(', ')}{names.length > 1 ? ' and ' : ''}{names[names.length - 1]}</span> : ds.settings.familyName} lines, built outward from {root.givenNames.split(' ')[0]}, one sourced fact at a time, with the family invited to add what they remember.</p>
        <div className="stats">
          <div><strong>{real.length}</strong><span>people named</span></div>
          <div><strong>{sourced}</strong><span>sourced events</span></div>
          <div><strong>{slots.length}</strong><span>slots waiting on facts</span></div>
          <div><strong>{ds.invitations.filter((i) => i.status === 'active').length}</strong><span>relatives contributing</span></div>
        </div>
        <Constellation ds={ds} className="constellation" />
      </section>

      {mode === 'local' && (
        <div className="banner warn">
          <strong>Local draft.</strong> Everything is saved in this browser only. Export a backup from Admin any time.
        </div>
      )}

      <section className="grid" style={{ marginBottom: 24 }}>
        <Link to="/tree" className="card link paternal"><h3>The living tree</h3><p className="muted">Every generation, both sides, with pencil and pen marked.</p></Link>
        <Link to="/map" className="card link household"><h3>The map</h3><p className="muted">Where people were born, lived and died, and how the family moved.</p></Link>
        <Link to="/timeline" className="card link maternal"><h3>The timeline</h3><p className="muted">Pick a year and see who was alive, where, and what was going on.</p></Link>
        <Link to="/related" className="card link"><h3>How are we related?</h3><p className="muted">Pick any two people and trace the connection.</p></Link>
      </section>

      <section className="grid">
        <div className="card span2">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>What the family has been doing</h3>
            <span className="row">
              {waiting.inbox > 0 && <Link className="pill warn" to="/admin/inbox">{waiting.inbox} to review</Link>}
              {waiting.requests > 0 && <Link className="pill warn" to="/admin/requests">{waiting.requests} asking for a link</Link>}
              {waiting.disputes > 0 && <Link className="pill bad" to="/admin/inbox">{waiting.disputes} under question</Link>}
              {waiting.unopened > 0 && <Link className="pill" to="/admin/invites">{waiting.unopened} link{waiting.unopened > 1 ? 's' : ''} not opened yet</Link>}
            </span>
          </div>
          {feed.length === 0 ? (
            <p className="muted">Nothing yet. When a relative opens their link, confirms a record or sends something in, it shows here.</p>
          ) : (
            <ul className="activity">
              {feed.map((a, i) => (
                <li key={i}><span className={`dot ${a.kind}`} /><span>{a.link ? <Link to={a.link} style={{ textDecoration: 'none' }}>{a.text}</Link> : a.text}</span><time dateTime={a.at} title={new Date(a.at).toLocaleString()}>{timeAgo(a.at)}</time></li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Open questions</h3>
          <div className="big">{openQ.length}</div>
          {openQ.slice(0, 4).map((q) => <div key={q.id} className="question">{q.title}</div>)}
          <Link to="/admin/research" className="btn small">Research backlog</Link>
        </div>
        <div className="card">
          <h3>Waiting on facts</h3>
          <div className="big">{slots.length}</div>
          <p className="muted">slots with no name yet. Nothing is guessed; these fill in only from what the family says or what records show.</p>
          <div className="stack">{slots.map((p) => <PersonChip key={p.id} ds={ds} p={p} />)}</div>
        </div>
      </section>
    </main>
  );
}
