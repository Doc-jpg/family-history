import { useState } from 'react';
import type { Dataset, Person } from '../model/types';
import { standingOf } from '../model/standing';

// Pencil and pen, as the relative sees it: where this person's record stands, who vouched for
// it, and two buttons. "Looks right" is a confirmation; "Something's off" asks what and goes to
// the admin's inbox as a dispute. One stance per person per relative; a new one replaces it.
export function StandingPill({ ds, personId }: { ds: Dataset; personId: string }) {
  const d = standingOf(ds, personId);
  const cls = d.standing === 'documented' || d.standing === 'pen' ? 'ok' : d.standing === 'disputed' ? 'bad' : d.standing === 'pencil' ? 'warn' : '';
  const text = d.standing === 'documented' ? 'documented' : d.standing === 'pen' ? 'in pen' : d.standing === 'pencil' ? 'in pencil' : d.standing === 'disputed' ? 'disputed' : 'unconfirmed';
  return <span className={`pill ${cls}`} title={d.summary}>{text}</span>;
}

export default function StandingCard({ ds, person, myId, canAttest, onAttest }: { ds: Dataset; person: Person; myId?: string; canAttest: boolean; onAttest: (stance: 'confirm' | 'dispute', note?: string, field?: string) => Promise<boolean> }) {
  const d = standingOf(ds, person.id);
  const mine = (ds.attestations ?? []).find((a) => a.personId === person.id && a.by === myId && !a.resolvedAt);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [field, setField] = useState('general');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  async function send(stance: 'confirm' | 'dispute') {
    setBusy(true);
    try {
      const ok = await onAttest(stance, stance === 'dispute' ? note.trim() || undefined : undefined, stance === 'dispute' && field !== 'general' ? field : undefined);
      setDone(ok ? (stance === 'confirm' ? 'Thank you. Your confirmation is recorded.' : 'Thank you. This is flagged and goes to the family historian to look into.') : 'That could not be sent. Try again in a moment.');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ padding: 12, borderStyle: d.standing === 'pencil' || d.standing === 'disputed' ? 'dashed' : 'solid' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{d.standing === 'documented' ? 'Backed by a record' : d.standing === 'pen' ? 'Written in pen' : d.standing === 'pencil' ? 'Written in pencil' : d.standing === 'disputed' ? 'Under question' : 'Not yet confirmed by family'}</strong>
        <StandingPill ds={ds} personId={person.id} />
      </div>
      <p className="muted" style={{ margin: '6px 0' }}>{d.summary}</p>
      {done && <p style={{ margin: '6px 0' }}>{done}</p>}
      {canAttest && !done && (
        <>
          {mine && <p className="muted" style={{ margin: '4px 0' }}>You said earlier: {mine.stance === 'confirm' ? 'looks right' : `something's off${mine.note ? ` (${mine.note})` : ''}`}. You can change that below.</p>}
          {!open ? (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn primary small" disabled={busy} onClick={() => send('confirm')}>Looks right to me</button>
              <button className="btn small" disabled={busy} onClick={() => setOpen(true)}>Something's off</button>
            </div>
          ) : (
            <div className="stack" style={{ marginTop: 6 }}>
              <label className="field">What is wrong?<select value={field} onChange={(e) => setField(e.target.value)}><option value="general">Not sure / general</option><option value="name">The name</option><option value="birth">Birth date or place</option><option value="death">Death date or place</option><option value="parents">The parents</option><option value="spouse">The spouse or partner</option><option value="children">The children</option><option value="identity">This is the wrong person entirely</option></select></label>
              <label className="field">Tell us what you know instead<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. her maiden name was Carter, not Cole; he was born in 1933, not 1935" /></label>
              <div className="row"><button className="btn primary small" disabled={busy || !note.trim()} onClick={() => send('dispute')}>Send</button><button className="btn small" onClick={() => setOpen(false)}>Cancel</button></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
