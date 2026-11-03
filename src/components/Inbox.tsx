import { useState } from 'react';
import type { Contribution, ContributionStatus, Dataset } from '../model/types';
import { REVIEW_ACTIONS, applyPersonCorrection, reviewContribution } from '../model/review';
import { Link } from 'react-router-dom';
import MediaItem from './MediaItem';

interface Props { ds: Dataset; update: (fn: (ds: Dataset) => Dataset) => void }

export default function Inbox({ ds, update }: Props) {
  const [filter, setFilter] = useState<ContributionStatus | 'all'>('new');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const list = ds.contributions.filter((c) => filter === 'all' || c.status === filter);

  function act(c: Contribution, status: ContributionStatus) {
    update((d) => {
      let next = reviewContribution(d, c.id, status, 'admin', notes[c.id]);
      if ((status === 'approved' || status === 'partial') && c.subject.type === 'person' && c.fields && Object.keys(c.fields).length) next = applyPersonCorrection(next, c, 'admin');
      return next;
    });
  }

  return (
    <div className="stack">
      <div className="row">
        <strong>Show:</strong>
        {(['new', 'research', 'clarify', 'disputed', 'approved', 'partial', 'rejected', 'all'] as const).map((s) => <button key={s} className={`btn small ${filter === s ? 'primary' : ''}`} onClick={() => setFilter(s)}>{s} ({s === 'all' ? ds.contributions.length : ds.contributions.filter((c) => c.status === s).length})</button>)}
      </div>
      {list.length === 0 && <p className="empty">Nothing here.</p>}
      {list.map((c) => {
        const inv = ds.invitations.find((i) => i.id === c.invitationId);
        return (
          <div className="card" key={c.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{c.contributorName}</strong> <small className="muted">{c.contributorIdentity ? `(${c.contributorIdentity}, verified)` : inv ? `(invitation ${inv.recipientName}, ${inv.role})` : ''} · {new Date(c.submittedAt).toLocaleString()}</small>
                <div className="row" style={{ marginTop: 4 }}><span className="pill">{c.kind}</span><span className={`pill ${c.status === 'new' ? 'warn' : c.status === 'approved' ? 'ok' : ''}`}>{c.status}</span>
                  <span>about {c.subject.type}: {c.subject.id && c.subject.type === 'person' ? <Link to={`/person/${c.subject.id}`}>{c.subject.label}</Link> : c.subject.label}</span></div>
              </div>
            </div>
            <p style={{ marginTop: 10 }}><strong>Proposes:</strong> {c.proposal}</p>
            {c.fields && Object.keys(c.fields).length > 0 && <dl className="kv">{Object.entries(c.fields).map(([k, v]) => <><dt key={k + 'k'}>{k}</dt><dd key={k + 'v'}>{v}</dd></>)}</dl>}
            {c.reasoning && <p><strong>Why they believe it:</strong> {c.reasoning}</p>}
            {c.attachmentMediaIds.length > 0 && <div className="stack" style={{ marginTop: 8 }}><strong>Attachments ({c.attachmentMediaIds.length})</strong>{c.attachmentMediaIds.map((id) => { const m = ds.media.find((x) => x.id === id); return m ? <MediaItem key={id} m={m} /> : <span key={id} className="muted">{id}</span>; })}</div>}
            {c.reviewNotes && <p className="muted"><em>Review note: {c.reviewNotes}</em></p>}
            <label className="field">Note to keep with this decision<input value={notes[c.id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} placeholder="optional" /></label>
            <div className="row" style={{ marginTop: 10 }}>
              {REVIEW_ACTIONS.map((a) => <button key={a.status} className={`btn small ${a.status === 'approved' ? 'primary' : ''}`} title={a.help} onClick={() => act(c, a.status)} disabled={c.status === a.status}>{a.label}</button>)}
            </div>
            <details style={{ marginTop: 8 }}><summary className="muted">History ({c.history.length})</summary>
              {c.history.map((h, i) => <div key={i}><small>{new Date(h.at).toLocaleString()} · {h.by} · {h.action}{h.note ? ` · ${h.note}` : ''}</small></div>)}
            </details>
          </div>
        );
      })}
    </div>
  );
}
