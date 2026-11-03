import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { PersonChip } from '../components/PersonBits';
import { personById } from '../model/graph';

export default function Home() {
  const { ds, mode } = useStore();
  const real = ds.people.filter((p) => !p.placeholder);
  const slots = ds.people.filter((p) => p.placeholder);
  const root = personById(ds, ds.settings.rootPersonId)!;
  const openQ = ds.questions.filter((q) => q.status === 'open');
  const inbox = ds.contributions.filter((c) => c.status === 'new');
  const sourced = ds.events.filter((e) => e.sourceIds.length).length;

  return (
    <main className="page">
      <section className="hero">
        <h1>Where we came from.</h1>
        <p className="lede">
          A living record of the {ds.settings.familyName} family, built outward from {root.givenNames.split(' ')[0]} through both sides, one verified fact at a time, with relatives invited to add what they remember.
        </p>
        {mode === 'local' && (
          <div className="banner warn">
            <strong>Local draft.</strong> Everything is saved in this browser only. Once the family database is connected, invitations and contributions become real and everything syncs. Export a backup from Admin any time.
          </div>
        )}
      </section>

      <section className="grid" style={{ marginBottom: 28 }}>
        <Link to="/tree" className="card link"><h3>The Living Tree</h3><p className="muted">Expand generations, follow a branch, see what is verified and what is still a guess.</p></Link>
        <Link to="/map" className="card link"><h3>The Family Map</h3><p className="muted">Where people were born, lived and died, and how the family moved.</p></Link>
        <Link to="/timeline" className="card link"><h3>The Timeline</h3><p className="muted">Pick a year and see who was alive, where, and what was happening around them.</p></Link>
        <Link to="/related" className="card link"><h3>How are we related?</h3><p className="muted">Pick any two people and trace the connection.</p></Link>
      </section>

      <section className="grid">
        <div className="card">
          <h3>Recorded so far</h3>
          <div className="big">{real.length}</div>
          <p className="muted">people with at least a name, {sourced} sourced events</p>
          <div className="stack">{real.map((p) => <PersonChip key={p.id} ds={ds} p={p} />)}</div>
        </div>
        <div className="card">
          <h3>Waiting on facts</h3>
          <div className="big">{slots.length}</div>
          <p className="muted">slots in the tree with no name yet. Nothing is guessed; these fill in only from what the family tells us or what records show.</p>
          <div className="stack">{slots.map((p) => <PersonChip key={p.id} ds={ds} p={p} />)}</div>
        </div>
        <div className="card">
          <h3>Open questions</h3>
          <div className="big">{openQ.length}</div>
          {openQ.slice(0, 5).map((q) => <div key={q.id} className="question">{q.title}</div>)}
          <Link to="/admin/research" className="btn small">Research backlog</Link>
        </div>
        <div className="card">
          <h3>Contribution inbox</h3>
          <div className="big">{inbox.length}</div>
          <p className="muted">new submissions from relatives waiting for review{ds.accessRequests.filter((r) => r.status === 'new').length ? `, and ${ds.accessRequests.filter((r) => r.status === 'new').length} request(s) for access` : ''}</p>
          <div className="row"><Link to="/admin/inbox" className="btn small">Open inbox</Link><Link to="/admin/requests" className="btn small">Requests</Link></div>
        </div>
      </section>
    </main>
  );
}
