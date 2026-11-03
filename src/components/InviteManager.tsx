import { useState } from 'react';
import type { AccessScope, Branch, Dataset, Invitation, Role } from '../model/types';
import { MAX_CODE_ATTEMPTS, createInvitation, releaseDevice, suggestScope } from '../model/access';
import { displayName } from '../model/graph';
import { audit } from '../model/review';

interface Props { ds: Dataset; update: (fn: (ds: Dataset) => Dataset) => void }

export default function InviteManager({ ds, update }: Props) {
  const [name, setName] = useState('');
  const [personId, setPersonId] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState<Role>('contributor');
  const [scope, setScope] = useState<AccessScope>({ branches: ['paternal', 'maternal'], personIds: [], includeLivingDetails: false });
  const [days, setDays] = useState(30);
  const [forwarded, setForwarded] = useState<NonNullable<Invitation['forwarded']>>('view');
  const [made, setMade] = useState<{ link: string; code: string; inv: Invitation } | null>(null);

  const base = `${window.location.origin}${window.location.pathname}#/invite/`;

  async function make() {
    const r = await createInvitation({ recipientName: name.trim() || displayName(ds.people.find((p) => p.id === personId)!), personId: personId || undefined, email: email || undefined, deliveryNote: note || undefined, role, scope, days });
    r.invitation.forwarded = forwarded;
    update((d) => audit({ ...d, invitations: [r.invitation, ...d.invitations] }, { actor: 'admin', action: 'create-invitation', entity: 'invitation', entityId: r.invitation.id, after: { name: r.invitation.recipientName, role, scope } }));
    setMade({ link: base + r.rawToken, code: r.code, inv: r.invitation });
    setName(''); setEmail(''); setNote('');
  }
  function setStatus(id: string, status: Invitation['status']) {
    update((d) => audit({ ...d, invitations: d.invitations.map((i) => (i.id === id ? { ...i, status } : i)) }, { actor: 'admin', action: `invitation:${status}`, entity: 'invitation', entityId: id }));
  }
  const toggleBranch = (b: Branch) => setScope((s) => ({ ...s, branches: s.branches.includes(b) ? s.branches.filter((x) => x !== b) : [...s.branches, b] }));

  /** A look-only link for the whole family: no code is ever entered, so every device opens it view-only. Anyone who wants to add asks for their own link from inside it. */
  async function makeViewingLink() {
    const r = await createInvitation({ recipientName: 'the family', deliveryNote: 'shared viewing link; the code is never given out', role: 'viewer', scope: { branches: ['paternal', 'maternal', 'household'], personIds: [], includeLivingDetails: false }, days: 365 });
    r.invitation.forwarded = 'view';
    update((d) => audit({ ...d, invitations: [r.invitation, ...d.invitations] }, { actor: 'admin', action: 'create-viewing-link', entity: 'invitation', entityId: r.invitation.id }));
    setMade({ link: base + r.rawToken, code: r.code, inv: r.invitation });
  }
  const viewingLinks = ds.invitations.filter((i) => i.role === 'viewer' && !i.personId && i.status !== 'revoked' && i.recipientName === 'the family');

  return (
    <div className="stack">
      <div className="card">
        <h3>Share with the whole family (look only)</h3>
        <p className="muted">One link anyone can open, forward, or post in a family group chat. It shows the tree with nobody's living birth details and no way to change anything. Inside it, a relative who wants to add their part taps "Request access to contribute" and lands on your Requests tab; you grant them a personal link and code from there.{viewingLinks.length ? ` Active viewing links: ${viewingLinks.length}.` : ''}</p>
        <button className="btn" onClick={makeViewingLink}>Create a family viewing link</button>
      </div>
      <div className="card">
        <h3>Invite a relative</h3>
        <p className="muted">Each person gets their own link plus a separate 6-digit code, given by text or phone. The first device that enters the code becomes the only device that can contribute. If they forward the link, it opens view-only elsewhere (or not at all, your choice below), and the other person is offered a "request access" form that comes to your Requests tab. The database stores only hashes of the token, the code and the device.</p>
        <div className="form-grid">
          <label className="field">Who in the tree? (optional)<select value={personId} onChange={(e) => { setPersonId(e.target.value); if (e.target.value) setScope(suggestScope(ds, e.target.value)); }}><option value="">Not in the tree yet</option>{ds.people.filter((p) => !p.placeholder && p.id !== ds.settings.rootPersonId).map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}</select></label>
          <label className="field">Name to greet them by<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aunt Linda" /></label>
          <label className="field">Email (for verification later)<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></label>
          <label className="field">How you will deliver it<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="text message, phone call" /></label>
          <label className="field">Role<select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="viewer">Viewer: explore only</option><option value="contributor">Contributor: explore and submit</option><option value="editor">Trusted editor: submissions auto-flagged for fast review</option></select></label>
          <label className="field">Expires in (days)<input type="number" value={days} onChange={(e) => setDays(+e.target.value)} /></label>
          <label className="field">If the link is forwarded to another device<select value={forwarded} onChange={(e) => setForwarded(e.target.value as NonNullable<Invitation['forwarded']>)}><option value="view">Opens view-only, no code needed (shareable)</option><option value="view-with-code">Opens view-only, code still required</option><option value="refuse">Does not open at all</option></select></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <strong>They may see:</strong>
          {(['paternal', 'maternal', 'household'] as Branch[]).map((b) => <label key={b} className="check"><input type="checkbox" checked={scope.branches.includes(b)} onChange={() => toggleBranch(b)} /> {b}</label>)}
          <label className="check"><input type="checkbox" checked={scope.includeLivingDetails} onChange={(e) => setScope((s) => ({ ...s, includeLivingDetails: e.target.checked }))} /> birth details of living people</label>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Empty slots and anyone marked private are never shown to relatives, whatever the scope.</p>
        <button className="btn primary" style={{ marginTop: 10 }} onClick={make} disabled={!name.trim() && !personId}>Create invitation</button>
      </div>
      {made && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h3>Invitation for {made.inv.recipientName}</h3>
          <p><strong>Link</strong> (send this): <code className="token">{made.link}</code></p>
          {made.inv.recipientName === 'the family' ? (
            <p className="muted">Share the link however you like. Do not give out the code: as long as nobody enters it, every device opens the link view-only.</p>
          ) : (
            <>
              <p><strong>Code</strong> (give separately, by text or phone): <code className="token" style={{ fontSize: '1.3rem' }}>{made.code}</code></p>
              <p className="muted">This is the only time the code is shown. If it is lost, revoke and create a new invitation.</p>
            </>
          )}
          <div className="row"><button className="btn small" onClick={() => navigator.clipboard?.writeText(made.link)}>Copy link</button><button className="btn small" onClick={() => setMade(null)}>Done</button></div>
        </div>
      )}
      <div className="card">
        <h3>Invitations</h3>
        {ds.invitations.length === 0 && <p className="muted">None yet.</p>}
        <table className="list">
          <thead><tr><th>Who</th><th>Role</th><th>Sees</th><th>Status</th><th>Device</th><th>Expires</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            {ds.invitations.map((i) => (
              <tr key={i.id}>
                <td><strong>{i.recipientName}</strong><br /><small className="muted">{i.email ?? i.deliveryNote ?? ''}</small></td>
                <td>{i.role}</td>
                <td><small>{i.scope.branches.join(', ') || 'specific people only'}{i.scope.includeLivingDetails ? ' + living details' : ''}</small></td>
                <td><span className={`pill ${i.status === 'active' ? 'ok' : i.status === 'pending' ? 'warn' : 'bad'}`}>{i.status}</span>{i.verifiedIdentity && <><br /><small>{i.verifiedIdentity}</small></>}</td>
                <td><small>{i.deviceHash ? <>{i.deviceLabel ?? 'bound'}<br />{i.boundAt?.slice(0, 10)}<br /><button className="btn small" title="Let the next device that enters the code become the contributor device (new phone, cleared browser)" onClick={() => update((d) => audit(releaseDevice(d, i.id), { actor: 'admin', action: 'release-device', entity: 'invitation', entityId: i.id }))}>Release</button></> : (i.codeAttempts ?? 0) >= MAX_CODE_ATTEMPTS ? <>locked after wrong codes<br /><button className="btn small" onClick={() => update((d) => audit(releaseDevice(d, i.id), { actor: 'admin', action: 'unlock-invitation', entity: 'invitation', entityId: i.id }))}>Unlock</button></> : 'not yet opened'}<br /><span className="muted">forwarded: {i.forwarded ?? 'view'}</span></small></td>
                <td><small>{i.expiresAt.slice(0, 10)}</small></td>
                <td><small>{i.lastSeenAt?.slice(0, 16).replace('T', ' ') ?? '—'}</small></td>
                <td className="row">{i.status !== 'revoked' ? <button className="btn small danger" onClick={() => setStatus(i.id, 'revoked')}>Revoke</button> : <button className="btn small" onClick={() => setStatus(i.id, 'pending')}>Reinstate</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
