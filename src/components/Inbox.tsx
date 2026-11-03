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
            {(() => {
              const subject = c.subject.type === 'person' && c.subject.id ? ds.people.find((p) => p.id === c.subject.id) : undefined;
              const fields = c.fields ?? {};
              const hasFields = Object.keys(fields).length > 0;
              const currentOf = (k: string): string => {
                if (!subject) return '';
                if (k === 'givenNames') return subject.givenNames;
                if (k === 'surname') return subject.surname;
                if (k === 'maidenName') return subject.maidenName ?? '';
                if (k === 'birth' || k === 'death') { const e = ds.events.find((x) => x.type === k && x.personIds.includes(subject.id)); return e ? `${e.date?.year ?? '?'}${e.placeId ? `, ${ds.places.find((pl) => pl.id === e.placeId)?.name ?? ''}` : ''}` : ''; }
                return '';
              };
              return (
                <div className="compare">
                  <div><h4>Now on record</h4>{subject ? (hasFields ? Object.keys(fields).map((k) => <div key={k}><small className="muted">{k}</small><br />{currentOf(k) || <span className="muted">nothing</span>}</div>) : <div>{subject.bio ? subject.bio.slice(0, 180) + (subject.bio.length > 180 ? '…' : '') : <span className="muted">No story yet.</span>}</div>) : <span className="muted">Not about one person.</span>}</div>
                  <div><h4>They propose</h4>{hasFields && Object.entries(fields).map(([k, v]) => <div key={k}><small className="muted">{k}</small><br /><span className={currentOf(k) && currentOf(k) !== v ? 'changed' : ''}>{v}</span></div>)}<div style={{ marginTop: hasFields ? 6 : 0 }}>{c.proposal}</div></div>
                  <div><h4>Their evidence</h4>{c.reasoning ? <div>{c.reasoning}</div> : <span className="muted">No reason given.</span>}{c.attachmentMediaIds.length > 0 && <div className="muted" style={{ marginTop: 4 }}>{c.attachmentMediaIds.length} attachment{c.attachmentMediaIds.length > 1 ? 's' : ''} below.</div>}</div>
                </div>
              );
            })()}
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
