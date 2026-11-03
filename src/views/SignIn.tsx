import { useState } from 'react';
import { useStore } from '../store/store';

// Cloud mode gate for everything except invitation links. The admin signs in with an emailed
// link; a signed-in account that is not in the `admins` table sees nothing.
export default function SignIn() {
  const { backend, auth, refresh } = useStore();
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!backend.signInWithEmail) return;
    setBusy(true);
    const r = await backend.signInWithEmail(email.trim());
    setMsg(r.message);
    setBusy(false);
  }
  if (auth.status === 'signed-in' && !auth.admin) {
    return (
      <main className="page" style={{ maxWidth: 560 }}>
        <div className="card" style={{ marginTop: 40 }}>
          <h1>Signed in, but not as the administrator</h1>
          <p className="muted">You are signed in as {auth.email}. This account is not the family archive's administrator, or the archive has not been loaded yet. If you were given an invitation, open the link you received instead.</p>
          <div className="row"><button className="btn" onClick={() => refresh()}>Check again</button><button className="btn" onClick={() => backend.signOut?.()}>Sign out</button></div>
        </div>
      </main>
    );
  }
  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="card" style={{ marginTop: 40 }}>
        <h1>Private family archive</h1>
        <p className="muted">Relatives: open the personal link you were sent. Administrator: sign in with your email and a link will be sent to you.</p>
        <label className="field">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
        <button className="btn primary" style={{ marginTop: 10 }} onClick={send} disabled={busy || !email.includes('@')}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
      </div>
    </main>
  );
}
