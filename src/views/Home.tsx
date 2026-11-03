import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { Avatar, lifespan } from '../components/PersonBits';
import { birthYear, displayName, personById } from '../model/graph';
import Constellation from '../components/Constellation';
import { activityFeed, timeAgo, waitingCounts } from '../model/activity';
import { LinkIcon, MapIcon, TimeIcon, TreeIcon } from '../components/Icons';
import type { Person } from '../model/types';

export default function Home() {
  const { ds, mode } = useStore();
  const real = ds.people.filter((p) => !p.placeholder);
  const slots = ds.people.filter((p) => p.placeholder);
  const root = personById(ds, ds.settings.rootPersonId)!;
  const sourced = ds.events.filter((e) => e.sourceIds.length).length;
  const gens = new Set(real.map((p) => p.generation)).size;
  const years = real.map((p) => birthYear(ds, p.id)).filter((y): y is number => !!y);
  const earliest = years.length ? Math.min(...years) : undefined;
  const counts = new Map<string, number>();
  for (const p of real) for (const n of [p.surname, p.maidenName]) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
  const feed = activityFeed(ds, 8);
  const waiting = waitingCounts(ds);
  const oldest = (branch: Person['branch']) => real.filter((p) => p.branch === branch).sort((a, b) => (birthYear(ds, a.id) ?? 9999) - (birthYear(ds, b.id) ?? 9999)).slice(0, 3);
  const branchCount = (branch: Person['branch']) => real.filter((p) => p.branch === branch).length;
  const withBio = real.filter((p) => p.bio && p.living === 'no').sort((a, b) => (birthYear(ds, a.id) ?? 0) - (birthYear(ds, b.id) ?? 0)).slice(0, 3);

  return (
    <main className="page">
      <section className="band">
        <h1>{gens} generations, {earliest ? `${earliest} to today` : 'and counting'}.</h1>
        <p>The {names.length ? <span className="names">{names.slice(0, -1).join(', ')}{names.length > 1 ? ' and ' : ''}{names[names.length - 1]}</span> : ds.settings.familyName} lines, built outward from {root.givenNames.split(' ')[0]}, one sourced fact at a time.</p>
        <div className="actions">
          <Link to="/tree" className="btn primary"><TreeIcon />Explore the family</Link>
          <Link to={`/person/${root.id}`} className="btn">Start with {root.givenNames.split(' ')[0]}</Link>
        </div>
        <div className="stats">
          <div><strong>{real.length}</strong><span>people named</span></div>
          <div><strong>{sourced}</strong><span>sourced events</span></div>
          <div><strong>{ds.sources.length}</strong><span>records cited</span></div>
          <div><strong>{ds.invitations.filter((i) => i.status === 'active').length}</strong><span>relatives contributing</span></div>
        </div>
        <Constellation ds={ds} className="constellation" />
      </section>

      {mode === 'local' && <div className="banner warn"><strong>Local draft.</strong> Everything is saved in this browser only. Export a backup from Admin any time.</div>}

      <section className="grid" style={{ marginBottom: 8 }}>
        <Link to="/tree" className="card link tree"><span className="icon"><TreeIcon /></span><h3>The living tree</h3><p className="muted">Every generation on both sides. Dotted rings are pencil; solid is pen.</p></Link>
        <Link to="/map" className="card link map"><span className="icon"><MapIcon /></span><h3>The map</h3><p className="muted">Where people were born, lived and were buried, and how the family moved.</p></Link>
        <Link to="/timeline" className="card link timeline"><span className="icon"><TimeIcon /></span><h3>The timeline</h3><p className="muted">Pick a year and see who was alive, and what was going on around them.</p></Link>
        <Link to="/related" className="card link related"><span className="icon"><LinkIcon /></span><h3>How are we related?</h3><p className="muted">Pick any two people and trace the connection.</p></Link>
      </section>

      <div className="section-title"><h2>Two sides of the family</h2><Link to="/tree">See the whole tree</Link></div>
      <section className="grid">
        {(['paternal', 'maternal'] as const).map((b) => (
          <div className="card" key={b} style={{ borderTop: `4px solid var(--${b})` }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>{b === 'paternal' ? `${root.givenNames.split(' ')[0]}'s father's side` : `${root.givenNames.split(' ')[0]}'s mother's side`}</h3><span className="pill">{branchCount(b)} people</span></div>
            <p className="muted" style={{ margin: '6px 0 10px' }}>Earliest known:</p>
            <div className="stack">{oldest(b).map((p) => <Link key={p.id} to={`/person/${p.id}`} className="chip"><Avatar p={p} size="sm" /><span>{displayName(p)} <small className="muted">{lifespan(ds, p)}</small></span></Link>)}{!oldest(b).length && <span className="muted">Nobody recorded yet.</span>}</div>
          </div>
        ))}
      </section>

      {withBio.length > 0 && (
        <>
          <div className="section-title"><h2>Lives worth reading</h2></div>
          <section className="grid">
            {withBio.map((p) => (
              <Link key={p.id} to={`/person/${p.id}`} className="card link" style={{ borderLeft: `4px solid var(--${p.branch === 'both' ? 'gold' : p.branch})` }}>
                <div className="row" style={{ gap: 12 }}><Avatar p={p} size="md" /><div><strong>{displayName(p)}</strong><br /><small className="muted">{lifespan(ds, p)}</small></div></div>
                <p className="muted" style={{ margin: '10px 0 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.bio}</p>
              </Link>
            ))}
          </section>
        </>
      )}

      <div className="section-title"><h2>Recent discoveries</h2><Link to="/admin">Admin</Link></div>
      <section className="grid">
        <div className="card span2">
          <div className="row" style={{ marginBottom: 6 }}>
            {waiting.inbox > 0 && <Link className="pill warn" to="/admin/inbox">{waiting.inbox} to review</Link>}
            {waiting.requests > 0 && <Link className="pill warn" to="/admin/requests">{waiting.requests} asking for a link</Link>}
            {waiting.disputes > 0 && <Link className="pill bad" to="/admin/inbox">{waiting.disputes} under question</Link>}
            {waiting.unopened > 0 && <Link className="pill" to="/admin/invites">{waiting.unopened} link{waiting.unopened > 1 ? 's' : ''} not opened yet</Link>}
          </div>
          {feed.length === 0 ? (
            <p className="muted">Quiet so far. When a relative opens their link, confirms a record or sends something in, it shows here.</p>
          ) : (
            <ul className="activity">{feed.map((a, i) => <li key={i}><span className={`dot ${a.kind}`} /><span>{a.link ? <Link to={a.link} style={{ textDecoration: 'none' }}>{a.text}</Link> : a.text}</span><time dateTime={a.at} title={new Date(a.at).toLocaleString()}>{timeAgo(a.at)}</time></li>)}</ul>
          )}
        </div>
        <div className="card">
          <h3>Still unknown</h3>
          <div className="big">{slots.length + ds.questions.filter((q) => q.status === 'open').length}</div>
          <p className="muted">{slots.length} slot{slots.length === 1 ? '' : 's'} with no name yet and {ds.questions.filter((q) => q.status === 'open').length} open questions. Nothing is guessed; these fill in only from what the family says or what records show.</p>
          <Link to="/admin/research" className="btn small">Research backlog</Link>
        </div>
      </section>
    </main>
  );
}
