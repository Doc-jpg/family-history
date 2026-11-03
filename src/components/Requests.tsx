import { useState } from 'react';
import type { Dataset, Role } from '../model/types';
import { grantAccessRequest, type CreatedInvitation } from '../model/access';
import { audit } from '../model/review';

interface Props { ds: Dataset; update: (fn: (ds: Dataset) => Dataset) => void }

// People who opened a forwarded, dead or someone else's link and asked for their own access.
export default function Requests({ ds, update }: Props) {
  const [made, setMade] = useState<{ name: string; created: CreatedInvitation } | null>(null);
  const [role, setRole] = useState<Role>('contributor');
  const base = `${window.location.origin}${window.location.pathname}#/invite/`;
  const list = [...ds.accessRequests].sort((a, b) => (a.status === 'new' ? -1 : 1) - (b.status === 'new' ? -1 : 1));

  async function grant(id: string) {
    const r = await grantAccessRequest(ds, id, role);
    if (!r) return;
    update((d) => audit({ ...d, invitations: r.ds.invitations, accessRequests: r.ds.accessRequests }, { actor: 'admin', action: 'grant-access-request', entity: 'access-request', entityId: id, after: { invitationId: r.created.invitation.id, role } }));
    setMade({ name: r.created.invitation.recipientName, created: r.created });
  }
  const decline = (id: string) => update((d) => audit({ ...d, accessRequests: d.accessRequests.map((r) => (r.id === id ? { ...r, status: 'declined' } : r)) }, { actor: 'admin', action: 'decline-access-request', entity: 'access-request', entityId: id }));

  return (
    <div className="stack">
      {made && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h3>Access granted to {made.name}</h3>
          <p><strong>Their link</strong> (send it): <code className="token">{base + made.created.rawToken}</code></p>
          <p><strong>Their code</strong> (send separately): <code className="token" style={{ fontSize: '1.3rem' }}>{made.created.code}</code></p>
          <p className="muted">Shown once. Their first device to enter the code becomes their contributor device.</p>
          <div className="row"><button className="btn small" onClick={() => navigator.clipboard?.writeText(base + made.created.rawToken)}>Copy link</button><button className="btn small" onClick={() => setMade(null)}>Done</button></div>
        </div>
      )}
      <div className="row"><strong>Grant as:</strong><select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="viewer">viewer</option><option value="contributor">contributor</option><option value="editor">trusted editor</option></select><span className="muted">Scope copies the link they came in on; adjust afterwards on the Invitations tab.</span></div>
      {list.length === 0 && <p className="empty">No requests yet. They appear here when someone opens a forwarded, expired or revoked link and asks for their own access.</p>}
      <table className="list">
        <thead><tr><th>Who</th><th>Related how</th><th>Contact</th><th>Came in via</th><th>When</th><th>Status</th><th></th></tr></thead>
        <tbody>{list.map((r) => {
          const via = ds.invitations.find((i) => i.id === r.viaInvitationId);
          return (
            <tr key={r.id}>
              <td><strong>{r.name}</strong>{r.message && <><br /><small className="muted">{r.message}</small></>}</td>
              <td>{r.relationship}{r.personId && <><br /><small className="muted">in the tree as {(() => { const p = ds.people.find((x) => x.id === r.personId); return p ? `${p.givenNames} ${p.surname}`.trim() : r.personId; })()}; a grant centers on them</small></>}</td>
              <td><small>{[r.email, r.phone].filter(Boolean).join(' · ') || '—'}</small></td>
              <td><small>{via ? `${via.recipientName}'s link` : 'no link'}</small></td>
              <td><small>{new Date(r.submittedAt).toLocaleString()}</small></td>
              <td><span className={`pill ${r.status === 'new' ? 'warn' : r.status === 'granted' ? 'ok' : 'bad'}`}>{r.status}</span></td>
              <td className="row">{r.status === 'new' && <><button className="btn small primary" onClick={() => grant(r.id)}>Grant</button><button className="btn small danger" onClick={() => decline(r.id)}>Decline</button></>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
