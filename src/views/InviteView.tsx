import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { ROLE_CAN, describeDevice, getDeviceId, type ProbeResult } from '../model/access';
import { childrenOf, displayName, formatDate, parentsOf, partnersOf } from '../model/graph';
import type { ContributionKind, Dataset, Invitation, Media, Person } from '../model/types';
import { ACCEPT, MAX_FILE_BYTES, kindOf, startRecording } from '../store/media';
import type { AccessRequestInput, ContributionInput, InviteApi, UploadedFile } from '../model/invite-api';
import TreeView from './TreeView';
import { ConfidencePill, PersonChip, lifespan } from '../components/PersonBits';
import MediaItem from '../components/MediaItem';

// What a relative sees. The token comes from their personal link; the code from the admin by
// another channel. The first device that unlocks the link owns it: the link stops working for
// contributing on any other device, and whoever opens it there is offered view-only or a
// request-access form. Every check goes through the InviteApi: in local mode that is the
// dataset in this browser (a demonstration on the admin's machine); in cloud mode it is the
// `invite` edge function, so the relative's browser only ever holds the redacted dataset.

const SESSION = 'family-history:invite-session';

const KINDS: { kind: ContributionKind; label: string; prompt: string; fields?: { key: string; label: string }[] }[] = [
  { kind: 'memory', label: 'Share a memory or story', prompt: 'What do you remember about this person? Anything at all: a saying, a habit, a holiday, a job, a house.' },
  { kind: 'correction', label: 'Correct a name, date or place', prompt: 'What should it say instead?', fields: [{ key: 'givenNames', label: 'Given names (if changing)' }, { key: 'surname', label: 'Surname (if changing)' }, { key: 'maidenName', label: 'Maiden name (if known)' }, { key: 'birth', label: 'Birth date and place' }, { key: 'death', label: 'Death date and place' }] },
  { kind: 'missing-person', label: 'Add someone who is missing', prompt: 'Who is missing, and how were they related? Siblings, a spouse, children, a parent.', fields: [{ key: 'name', label: 'Their full name' }, { key: 'relation', label: 'How they are related to this person' }, { key: 'dates', label: 'Any dates or places you know' }] },
  { kind: 'relationship', label: 'Fix a relationship', prompt: 'Which relationship is wrong or missing, and what is right?' },
  { kind: 'identify-photo', label: 'Identify someone in a photo', prompt: 'Which photo, and who do you recognize?' },
  { kind: 'location', label: 'Add a place they lived', prompt: 'Where did they live, and roughly when? A town, a farm, an address, a church.' },
  { kind: 'context', label: 'Add historical context', prompt: 'What was going on around them that shaped their life? (A move, a war, a job, a church, a business.)' },
  { kind: 'oral-history', label: 'Record an oral history', prompt: 'Tell it in your own words. You can paste a transcript or describe a recording you will send.' },
  { kind: 'dispute', label: 'This looks wrong', prompt: 'What do you believe is incorrect, and why?' },
  { kind: 'lead', label: 'Suggest a research lead', prompt: 'A cemetery, an obituary, a relative who knows, a family Bible, a county.' },
  { kind: 'branch-note', label: 'A note about the whole branch', prompt: 'Something that applies to the whole family line rather than one person.' },
  { kind: 'upload', label: 'Share photos, documents, audio or video', prompt: 'Old photographs, letters, a scanned certificate, a recording of someone telling a story, a video. Say who is in it and roughly when it was made.' },
  { kind: 'relationship', label: 'Add my own family (my branch)', prompt: 'Tell us your parents, spouse and children so your branch of the tree can grow from you. Names and rough years are plenty; the family historian will fill in the rest with you.', fields: [{ key: 'spouse', label: 'Spouse or partner (name, year married if known)' }, { key: 'parents', label: 'Your parents (names; maiden name if known)' }, { key: 'children', label: 'Your children (names, birth years)' }, { key: 'siblings', label: 'Your brothers and sisters' }, { key: 'grandparents', label: 'Your grandparents, if you know them' }] },
];

/** First name of the archive's root person, used in copy shown to relatives. */
function ownerName(ds: Dataset): string {
  const root = ds.people.find((p) => p.id === ds.settings.rootPersonId);
  return root?.givenNames.split(' ')[0] || 'the family historian';
}

export default function InviteView() {
  const { token = '' } = useParams();
  const { ds, update, backend, ready } = useStore();
  const api: InviteApi = useMemo(() => backend.invite(() => dsRef.current, update), [backend, update]);
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [inv, setInv] = useState<Invitation | null>(null);
  const [scoped, setScoped] = useState<Dataset | null>(null);
  const owner = ownerName(scoped ?? ds);
  const [mode, setMode] = useState<'full' | 'view'>('view');
  const [personId, setPersonId] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'tree'>('people');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [requested, setRequested] = useState(false);
  const [centerOnMe, setCenterOnMe] = useState(true);
  const deviceId = useMemo(() => getDeviceId(), []);

  // On load: restore a session if it is still valid, otherwise work out what this device may do.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      let restored = false;
      try {
        const s = JSON.parse(sessionStorage.getItem(SESSION) ?? 'null') as { token: string; mode: 'full' | 'view' } | null;
        if (s && s.token === token) {
          const r = await api.open(token, '', deviceId, describeDevice(), s.mode);
          if (r.ok && !cancelled) { setInv(r.invitation); setScoped(r.scoped); setMode(r.mode); restored = true; }
          else sessionStorage.removeItem(SESSION);
        }
      } catch { /* ignore */ }
      if (!restored) {
        const pr = await api.probe(token, deviceId);
        if (cancelled) return;
        setProbe(pr);
        // A device that is not the contributor device opens view-only straight away when the link allows it.
        if (pr.state === 'elsewhere' && (pr.invitation.forwarded ?? 'view') === 'view') await open('');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, deviceId, ready, api]);

  async function open(codeInput: string) {
    const r = await api.open(token, codeInput, deviceId, describeDevice());
    if (!r.ok) {
      setErr({ 'not-found': 'This link is not recognized.', revoked: 'This invitation has been turned off.', expired: 'This invitation has expired.', 'bad-code': 'That code does not match.', 'bound-elsewhere': 'This link is already in use on another device and was set not to open anywhere else.', 'code-required': 'A code is needed to open this link.', locked: 'Too many wrong codes. Ask for the link to be reset.' }[r.reason] ?? 'Something went wrong. Try again in a moment.');
      return;
    }
    sessionStorage.setItem(SESSION, JSON.stringify({ token, mode: r.mode }));
    setInv(r.invitation);
    setScoped(r.scoped);
    setMode(r.mode);
    setErr('');
  }

  /** After a submission, refresh the scoped view (new media records appear). */
  async function refreshScoped() {
    const r = await api.open(token, '', deviceId, describeDevice(), mode);
    if (r.ok) setScoped(r.scoped);
  }

  if (!inv || !scoped) {
    const dead = probe && (probe.state === 'not-found' || probe.state === 'revoked' || probe.state === 'expired');
    const elsewhere = probe?.state === 'elsewhere' ? probe.invitation : null;
    const fw = elsewhere ? elsewhere.forwarded ?? 'view' : 'view';
    return (
      <main className="page" style={{ maxWidth: 560 }}>
        {requested ? (
          <div className="card" style={{ marginTop: 40 }}><h1>Request sent</h1><p>{owner} will see your request and, if it is granted, send you a link and code of your own.</p></div>
        ) : showRequest || (elsewhere && fw === 'refuse') ? (
          <RequestAccess reason={elsewhere && fw === 'refuse' ? 'This link belongs to someone else\'s device.' : err} owner={owner} onSubmit={async (r) => { await api.requestAccess(token, deviceId, r); setRequested(true); }} />
        ) : dead ? (
          <div className="card" style={{ marginTop: 40 }}>
            <h1>{probe!.state === 'not-found' ? 'Link not recognized' : probe!.state === 'revoked' ? 'This invitation was turned off' : 'This invitation has expired'}</h1>
            <p className="muted">If you are family and would like your own access, you can ask for it.</p>
            <button className="btn primary" onClick={() => setShowRequest(true)}>Request access</button>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 40 }}>
            <h1>You've been invited</h1>
            {elsewhere ? (
              <p className="muted">This link was shared with {elsewhere.recipientName} and is already set up on their device. Enter the code to look around (view only), or request access of your own to add memories.</p>
            ) : (
              <p className="muted">This is a private family history. Enter the 6-digit code you were given separately. The first device that enters it becomes the one that can add memories and corrections.</p>
            )}
            <label className="field">Code<input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" autoFocus /></label>
            {err && <p style={{ color: 'var(--bad)' }}>{err}</p>}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => open(code)} disabled={code.trim().length < 6}>Open</button>
              {!elsewhere && fw === 'view' && <button className="btn" onClick={() => open('')}>No code? Just look around</button>}
              {elsewhere && <button className="btn" onClick={() => setShowRequest(true)}>Request my own access</button>}
            </div>
          </div>
        )}
      </main>
    );
  }

  const can = mode === 'full' ? ROLE_CAN[inv.role] : ROLE_CAN.viewer;
  const person = personId ? scoped.people.find((p) => p.id === personId) : null;
  const gens = [...new Set(scoped.people.map((p) => p.generation))].sort((a, b) => b - a);

  if (showRequest && !requested) {
    return <main className="page" style={{ maxWidth: 560 }}><RequestAccess reason="You are viewing a link that was shared with someone else, so this device can look but not add." owner={owner} onSubmit={async (r) => { await api.requestAccess(token, deviceId, r); setRequested(true); setShowRequest(false); }} /></main>;
  }

  return (
    <main className="page">
      {requested && <div className="banner" style={{ borderColor: 'var(--ok)' }}>Your request for contributor access is with {owner}.</div>}
      {mode === 'view' && !requested && (
        <div className="banner warn row" style={{ justifyContent: 'space-between' }}>
          <span><strong>View only.</strong> This link was shared with {inv.recipientName}; on this device you can look but not add. Want to contribute memories, photos or corrections?</span>
          <button className="btn primary small" onClick={() => setShowRequest(true)}>Request access to contribute</button>
        </div>
      )}
      <section className="hero" style={{ paddingTop: 16 }}>
        <h1>{mode === 'full' ? `Welcome, ${inv.recipientName}.` : 'The family, so far.'}</h1>
        <p className="lede">Here is what we know so far about the family. {can.contribute ? `Anything you remember, however small, helps. Nothing you add changes the record until ${owner} reviews it, so there is no way to break anything.` : mode === 'full' ? `You have been given a look-only link; if you would like to add memories, ask ${owner} for a contributor link.` : ''}</p>
        <div className="row"><span className="pill">{mode === 'full' ? inv.role : 'view only'}</span><span className="pill">you can see: {inv.scope.branches.join(', ') || 'selected people'}</span></div>
      </section>
      <nav className="tabs"><button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>People</button><button className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>Tree</button></nav>
      {tab === 'tree' && (
        <>
          {inv.personId && scoped.people.some((p) => p.id === inv.personId) && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button className={`btn small ${centerOnMe ? 'primary' : ''}`} onClick={() => setCenterOnMe(true)}>Center the tree on me</button>
              <button className={`btn small ${!centerOnMe ? 'primary' : ''}`} onClick={() => setCenterOnMe(false)}>Center on {owner}</button>
            </div>
          )}
          <div style={{ height: '70vh', position: 'relative', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}><TreeView data={scoped} rootId={centerOnMe && inv.personId ? inv.personId : undefined} onOpen={(id) => { setPersonId(id); setTab('people'); }} /></div>
        </>
      )}
      {tab === 'people' && !person && (
        <div className="grid">
          {gens.map((g) => (
            <div className="card" key={g}>
              <h3>{g === 0 ? `${owner}'s generation` : g > 0 ? `${g === 1 ? 'Parents' : g === 2 ? 'Grandparents' : g === 3 ? 'Great-grandparents' : `Generation ${g}`}` : 'Children'}</h3>
              <div className="stack">{scoped.people.filter((p) => p.generation === g).map((p) => <button key={p.id} className="btn" style={{ textAlign: 'left' }} onClick={() => setPersonId(p.id)}><PersonChip ds={scoped} p={p} to={false} /></button>)}</div>
            </div>
          ))}
          {can.contribute && <div className="card"><h3>Something that fits nowhere above?</h3><p className="muted">A note about the whole family, a lead, a photo you have.</p><button className="btn primary" onClick={() => setPersonId('__branch')}>Add a general note</button></div>}
        </div>
      )}
      {tab === 'people' && (person || personId === '__branch') && (
        <Contribute scoped={scoped} person={person ?? null} inv={inv} canContribute={can.contribute} onBack={() => setPersonId(null)} api={api} token={token} deviceId={deviceId} onSubmitted={refreshScoped} onRequest={() => setShowRequest(true)} />
      )}
    </main>
  );
}

function RequestAccess({ reason, owner, onSubmit }: { reason: string; owner: string; onSubmit: (r: Omit<AccessRequestInput, 'deviceHash' | 'viaInvitationId'>) => Promise<void> }) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await onSubmit({ name: name.trim(), relationship: relationship.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, message: message.trim() || undefined }); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ marginTop: 40 }}>
      <h1>Request your own access</h1>
      <p className="muted">{reason} Each family member gets a personal link and code. Tell {owner} who you are to get yours.</p>
      <div className="form-grid">
        <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">How you are related<input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder={`${owner}'s aunt, Mom's brother`} /></label>
        <label className="field">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Phone<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      </div>
      <label className="field" style={{ marginTop: 10 }}>Anything to add (optional)<textarea value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      <button className="btn primary" style={{ marginTop: 10 }} onClick={send} disabled={busy || !name.trim() || !relationship.trim() || !(email.trim() || phone.trim())}>Send request</button>
    </div>
  );
}

function Contribute({ scoped, person, inv, canContribute, onBack, api, token, deviceId, onSubmitted, onRequest }: { scoped: Dataset; person: Person | null; inv: Invitation; canContribute: boolean; onBack: () => void; api: InviteApi; token: string; deviceId: string; onSubmitted: () => Promise<void>; onRequest: () => void }) {
  const [kind, setKind] = useState<ContributionKind | null>(null);
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [rec, setRec] = useState<{ stop: () => Promise<Blob> } | null>(null);
  const [busy, setBusy] = useState('');
  const def = KINDS.find((k) => k.kind === kind);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_BYTES) { setBusy(`${f.name} is too large (limit ${Math.round(MAX_FILE_BYTES / 1048576)} MB).`); continue; }
      setBusy(`Saving ${f.name}…`);
      try {
        const up = await api.upload(token, deviceId, f, f.name, kindOf(f));
        setFiles((x) => [...x, up]);
        setBusy('');
      } catch (e) {
        setBusy(`${f.name} could not be saved: ${(e as Error).message}`);
      }
    }
  }
  async function toggleRecord() {
    if (rec) {
      const blob = await rec.stop();
      setRec(null);
      setBusy('Saving voice memo…');
      try {
        const up = await api.upload(token, deviceId, blob, `Voice memo ${new Date().toLocaleString()}.webm`, 'audio');
        setFiles((x) => [...x, up]);
        setBusy('');
      } catch (e) {
        setBusy(`The voice memo could not be saved: ${(e as Error).message}`);
      }
    } else {
      try { setRec(await startRecording()); } catch { setBusy('Microphone not available on this device or permission was refused.'); }
    }
  }
  const events = person ? scoped.events.filter((e) => e.personIds.includes(person.id)) : [];

  const [sending, setSending] = useState(false);
  async function submit() {
    const c: ContributionInput = {
      invitationId: inv.id,
      contributorName: inv.recipientName,
      contributorIdentity: inv.verifiedIdentity,
      kind: kind!,
      subject: person ? { type: 'person', id: person.id, label: displayName(person) } : { type: 'branch', label: inv.scope.branches.join(' & ') || 'family' },
      proposal: text.trim(),
      fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim())),
      reasoning: why.trim() || undefined,
      attachmentMediaIds: files.map((f) => f.id),
    };
    const media: Media[] = files.map((f) => ({ id: f.id, kind: f.kind, title: f.name, personIds: person ? [person.id] : [], caption: text.trim().slice(0, 200) || undefined, privacy: 'family', storagePath: f.storagePath }));
    setSending(true);
    try {
      const r = await api.submit(token, deviceId, c, media);
      if (!r.ok) { setBusy('That could not be sent. Check your connection and try again.'); return; }
      setSent(true); setText(''); setWhy(''); setFields({}); setKind(null); setFiles([]);
      await onSubmitted();
    } finally {
      setSending(false);
    }
  }
  const personMedia = person ? scoped.media.filter((m) => m.personIds.includes(person.id)) : [];

  return (
    <div className="stack">
      <div><button className="btn small" onClick={onBack}>← All people</button></div>
      {person && (
        <div className="card">
          <h2>{displayName(person)}</h2>
          <p className="row"><ConfidencePill c={person.confidence} /><span className="pill">{lifespan(scoped, person) || 'no dates recorded'}</span><span className="pill">{person.branch}</span></p>
          <p>{person.bio ?? <span className="muted">No story written yet. Do you know one?</span>}</p>
          <dl className="kv">
            <dt>Parents</dt><dd>{parentsOf(scoped, person.id).map((p) => displayName(p)).join(', ') || '—'}</dd>
            <dt>Partners</dt><dd>{partnersOf(scoped, person.id).map((x) => displayName(x.person)).join(', ') || '—'}</dd>
            <dt>Children</dt><dd>{childrenOf(scoped, person.id).map((p) => displayName(p)).join(', ') || '—'}</dd>
            {events.map((e) => <><dt key={e.id + 'k'}>{e.type}</dt><dd key={e.id + 'v'}>{formatDate(e.date) || 'date unknown'}{e.placeId ? `, ${scoped.places.find((pl) => pl.id === e.placeId)?.name ?? ''}` : ''} <ConfidencePill c={e.confidence} /></dd></>)}
          </dl>
          {personMedia.length > 0 && <div className="stack" style={{ marginTop: 10 }}>{personMedia.map((m) => <MediaItem key={m.id} m={m} resolve={(x) => api.mediaUrl(token, deviceId, x)} />)}</div>}
        </div>
      )}
      {sent && <div className="banner" style={{ borderColor: 'var(--ok)' }}>Thank you. It is in {ownerName(scoped)}'s review inbox. You can add more.</div>}
      {!canContribute && <div className="card"><h3>Know something about {person ? person.givenNames.split(' ')[0] : 'the family'}?</h3><p className="muted">Adding memories, corrections and photos needs contributor access, which is personal to each family member.</p><button className="btn primary" onClick={onRequest}>Request access to contribute</button></div>}
      {canContribute && !kind && (
        <div className="card">
          <h3>{person ? `Add to ${person.givenNames.split(' ')[0]}'s story` : 'Add a general note'}</h3>
          <div className="grid">{KINDS.filter((k) => (person ? k.kind !== 'branch-note' : ['branch-note', 'lead', 'context', 'identify-photo', 'missing-person', 'oral-history'].includes(k.kind))).map((k) => <button key={k.kind} className="btn" style={{ textAlign: 'left' }} onClick={() => setKind(k.kind)}>{k.label}</button>)}</div>
        </div>
      )}
      {canContribute && def && (
        <div className="card">
          <h3>{def.label}</h3>
          <p className="muted">{def.prompt}</p>
          {def.fields && <div className="form-grid">{def.fields.map((f) => <label key={f.key} className="field">{f.label}<input value={fields[f.key] ?? ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} /></label>)}</div>}
          <label className="field" style={{ marginTop: 10 }}>In your own words<textarea value={text} onChange={(e) => setText(e.target.value)} /></label>
          <label className="field" style={{ marginTop: 10 }}>How do you know? (optional, but it helps: "I was there", "it's on her headstone", "Grandma told me")<input value={why} onChange={(e) => setWhy(e.target.value)} /></label>
          <div className="card" style={{ marginTop: 10, padding: 12 }}>
            <strong>Attach something</strong> <span className="muted">photos, documents, audio, video</span>
            <div className="row" style={{ marginTop: 6 }}>
              <input type="file" multiple accept={ACCEPT} onChange={(e) => addFiles(e.target.files)} />
              <button className={`btn small ${rec ? 'danger' : ''}`} type="button" onClick={toggleRecord}>{rec ? '■ Stop recording' : '● Record a voice memo'}</button>
            </div>
            {busy && <p className="muted" style={{ marginTop: 6 }}>{busy}</p>}
            {files.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{files.map((f) => <li key={f.id}>{f.kind}: {f.name} <small className="muted">({Math.max(1, Math.round(f.size / 1024))} KB)</small> <button className="btn small" type="button" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>remove</button></li>)}</ul>}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>Your name is attached as "{inv.recipientName}" so {ownerName(scoped)} can follow up. Only the admin sees submissions until they are approved. Files you attach stay private to the family archive.</p>
          <div className="row"><button className="btn primary" onClick={submit} disabled={sending || (!text.trim() && !Object.values(fields).some((v) => v.trim()) && files.length === 0)}>{sending ? 'Sending…' : `Send to ${ownerName(scoped)}`}</button><button className="btn" onClick={() => setKind(null)}>Back</button></div>
        </div>
      )}
    </div>
  );
}
