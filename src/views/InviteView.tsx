import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { ROLE_CAN, describeDevice, getDeviceId, type ProbeResult } from '../model/access';
import { childrenOf, displayName, formatDate, howRelated, parentsOf, partnersOf } from '../model/graph';
import type { ContributionKind, Dataset, Invitation, Media, Person } from '../model/types';
import { ACCEPT, MAX_FILE_BYTES, kindOf, startRecording } from '../store/media';
import type { AccessRequestInput, ContributionInput, InviteApi, UploadedFile } from '../model/invite-api';
import TreeView from './TreeView';
import { ConfidencePill, PersonRow, lifespan } from '../components/PersonBits';
import { gapsFor, relativesOf, type Gap } from '../model/perspective';
import MediaItem from '../components/MediaItem';
import StandingCard, { StandingPill } from '../components/StandingCard';
import Constellation from '../components/Constellation';
import { needsConfirmation } from '../model/standing';

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
  const [tab, setTab] = useState<'people' | 'tree' | 'blanks'>('people');
  const [startKind, setStartKind] = useState<ContributionKind | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [requested, setRequested] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [centerOnMe, setCenterOnMe] = useState(true);
  const deviceId = useMemo(() => getDeviceId(), []);
  // A look-only visitor can pick themselves in the tree and see it from where they stand, before
  // they have a link of their own. Remembered per device and per link.
  const VIEW_AS = `family-history:view-as:${token}`;
  const [viewAs, setViewAsState] = useState<string | null>(() => { try { return localStorage.getItem(VIEW_AS); } catch { return null; } });
  const setViewAs = (id: string | null) => { setViewAsState(id); try { if (id) localStorage.setItem(VIEW_AS, id); else localStorage.removeItem(VIEW_AS); } catch { /* ignore */ } };
  const [requestPrefill, setRequestPrefill] = useState<{ name?: string; relationship?: string; message?: string; personId?: string } | null>(null);

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
        // A device that is not the contributor device opens view-only straight away when the link allows it,
        // and a look-only (viewer) link never asks for a code at all.
        if ('invitation' in pr && (pr.invitation.forwarded ?? 'view') === 'view' && (pr.state === 'elsewhere' || pr.invitation.role === 'viewer')) await open('');
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
      <main className="page invite" style={{ maxWidth: 560 }}>
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
  const chosen = viewAs ? scoped.people.find((p) => p.id === viewAs) ?? null : null;
  const me = chosen ?? (inv.personId ? scoped.people.find((p) => p.id === inv.personId) ?? null : null);
  // A forwarded, view-only visitor is not the invitee: say "Laura's mother", not "your mother",
  // unless they have picked themselves in the tree.
  const isMe = !!chosen || mode === 'full';
  const root = scoped.people.find((p) => p.id === scoped.settings.rootPersonId);
  const askForLink = (extra?: { message?: string }) => {
    const relation = me && root && me.id !== root.id ? `${owner}'s ${howRelated(scoped, me.id, root.id).label}` : '';
    setRequestPrefill({ name: me ? `${me.givenNames} ${me.surname}`.trim() : undefined, relationship: relation || undefined, personId: me?.id, ...extra });
    setShowRequest(true);
  };
  const whose = me ? (isMe ? 'your' : `${me.givenNames.split(' ')[0]}'s`) : '';
  const relLabel = (label: string) => {
    if (label.startsWith('connection') || label.startsWith('no known')) return label;
    const m = label.match(/^(.*) \(through (.+)\)$/);
    if (m) { const via = scoped.people.find((x) => displayName(x) === m[2]); return `${whose} ${m[1]} · through ${via ? via.givenNames.split(' ')[0] : m[2]}`; }
    return `${whose} ${label}`;
  };
  const groupTitle = (t: string) => (isMe ? t : t.replace(/^Your /, `${whose} `));
  const groups = me ? relativesOf(scoped, me.id) : [];
  const gaps: Gap[] = me ? gapsFor(scoped, me.id) : [];
  const toConfirm = me ? needsConfirmation(scoped, scoped.people.filter((p) => groups.some((g) => g.entries.some((e) => e.person.id === p.id && e.distance <= 3))), inv.id) : [];

  if (showRequest && !requested) {
    return <main className="page invite" style={{ maxWidth: 560 }}><RequestAccess reason={chosen ? `You are looking as ${chosen.givenNames.split(' ')[0]}. A link of your own lets you add memories, fix dates and fill blanks, with the tree centered on you.` : 'This link is look-only. A link of your own lets you add memories, fix dates and fill blanks, with the tree centered on you.'} owner={owner} initial={requestPrefill ?? undefined} onCancel={() => { setShowRequest(false); setRequestPrefill(null); }} onSubmit={async (r) => { await api.requestAccess(token, deviceId, { ...r, personId: requestPrefill?.personId }); setRequested(true); setShowRequest(false); setRequestPrefill(null); }} /></main>;
  }

  if (suggesting) {
    return <main className="page invite" style={{ maxWidth: 560 }}><RequestAccess reason={`Who should ${owner} invite? They will get their own link and code; you do not need to send anything yourself.`} owner={owner} suggest onCancel={() => setSuggesting(false)} onSubmit={async (r) => { await api.requestAccess(token, deviceId, { ...r, message: `Suggested by ${inv.recipientName}${r.message ? `: ${r.message}` : ''}` }); setSuggesting(false); setSuggested(true); }} /></main>;
  }

  return (
    <main className="page invite">
      {suggested && <div className="banner" style={{ borderColor: 'var(--ok)' }}>Thank you. {owner} will send them a link.</div>}
      {requested && <div className="banner" style={{ borderColor: 'var(--ok)' }}>Your request for contributor access is with {owner}.</div>}
      <section className="band invite">
        <h1>{isMe && me ? `Welcome, ${me.givenNames.split(' ')[0]}.` : mode === 'full' ? `Welcome, ${inv.recipientName.split(' ')[0]}.` : 'The family, so far.'}</h1>
        <p className="lede">{me ? (isMe ? `This is your family as we know it so far, seen from where you stand: your parents and grandparents, your children, your brothers and sisters. ` : `This is ${whose} family as we know it so far, seen from where ${me.givenNames.split(' ')[0]} stands. `) : 'Here is what we know so far about the family. '}{can.contribute ? `Anything you remember, however small, helps. Nothing you add changes the record until ${owner} reviews it, so there is no way to break anything.` : chosen ? `You are looking, not adding yet. When you are ready to add a memory, fix a date or fill a blank, ask ${owner} for a link of your own and it opens centered on you.` : `Everything here is as the family has told it so far. Find yourself below to see it from where you stand.`}</p>
        <div className="row">
          <span className="pill">{can.contribute ? 'you can add' : 'looking'}</span>
          {me && <span className="pill">centered on {isMe ? 'you' : me.givenNames.split(' ')[0]}</span>}
          {chosen && <button className="btn small" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }} onClick={() => { setViewAs(null); setPersonId(null); setTab('people'); }}>Not {chosen.givenNames.split(' ')[0]}?</button>}
          {!can.contribute && !requested && <button className="btn primary small" onClick={() => askForLink()}>Ask for my own link</button>}
          <span className="pill">everything is reviewed first</span>
        </div>
        <Constellation ds={scoped} className="constellation" />
      </section>
      {!can.contribute && !chosen && !requested && (
        <ViewAs scoped={scoped} owner={owner} onPick={(id) => { setViewAs(id); setPersonId(null); setTab('people'); }} onNotHere={() => askForLink({ message: 'Not in the tree yet.' })} />
      )}
      <nav className="tabs">
        <button className={tab === 'people' ? 'active' : ''} onClick={() => { setTab('people'); setPersonId(null); }}>{me ? (isMe ? 'Your people' : `${whose} people`) : 'People'}</button>
        <button className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>Tree</button>
        {me && (gaps.length > 0 || toConfirm.length > 0) && <button className={tab === 'blanks' ? 'active' : ''} onClick={() => { setTab('blanks'); setPersonId(null); }}>{can.contribute ? 'Fill in the blanks' : 'What is missing'} ({gaps.length + toConfirm.length})</button>}
      </nav>
      {tab === 'tree' && (
        <>
          {me && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button className={`btn small ${centerOnMe ? 'primary' : ''}`} onClick={() => setCenterOnMe(true)}>Center the tree on me</button>
              <button className={`btn small ${!centerOnMe ? 'primary' : ''}`} onClick={() => setCenterOnMe(false)}>Center on {owner}</button>
            </div>
          )}
          <div style={{ height: '70vh', position: 'relative', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}><TreeView data={scoped} rootId={centerOnMe && me ? me.id : undefined} onOpen={(id) => { setPersonId(id); setTab('people'); }} /></div>
        </>
      )}
      {tab === 'blanks' && me && (
        <div className="stack">
          {toConfirm.length > 0 && (
            <>
              <h3 style={{ margin: '4px 0 0' }}>Does this look right?</h3>
              <p className="muted">These were told to us by one person and nobody else has checked them yet. A second pair of eyes turns pencil into pen.</p>
              {toConfirm.map(({ person: p, detail }) => (
                <div className="gap" key={'c-' + p.id}>
                  <span><strong>{displayName(p)}</strong> <StandingPill ds={scoped} personId={p.id} /><br /><span className="rel-label">{detail.summary}</span></span>
                  <button className="btn primary small" onClick={() => { setPersonId(p.id); setTab('people'); }}>Check</button>
                </div>
              ))}
              <h3 style={{ margin: '12px 0 0' }}>Blanks you might fill</h3>
            </>
          )}
          <p className="muted">{can.contribute ? 'These are the things nobody has written down yet about your side of the family. Pick any one; a few words is plenty, and "I don\'t know" is a fine answer too.' : `These are the things nobody has written down yet about ${isMe ? 'your' : whose} side of the family. If you know one, ask ${owner} for a link of your own and you can answer it straight away.`}</p>
          {gaps.map((g) => (
            <div className="gap" key={g.id}>
              <span><strong>{g.question}</strong>{g.personId !== me.id && <><br /><span className="rel-label">{g.personName}</span></>}</span>
              {can.contribute ? <button className="btn primary small" onClick={() => { setStartKind(g.kind); setPersonId(g.personId); setTab('people'); }}>Answer</button> : <button className="btn small" onClick={() => askForLink({ message: `Can answer: ${g.question}${g.personId !== me.id ? ` (${g.personName})` : ''}` })}>I know this</button>}
            </div>
          ))}
        </div>
      )}
      {tab === 'people' && !person && personId !== '__branch' && (
        <div className="grid">
          {me ? (
            <>
              <div className="card" key="me">
                <h3>{isMe ? 'You' : me.givenNames.split(' ')[0]}</h3>
                <div className="rows"><PersonRow ds={scoped} p={me} right={<StandingPill ds={scoped} personId={me.id} />} onClick={() => setPersonId(me.id)} /></div>
              </div>
              {groups.map((g) => (
                <div className="card" key={g.title}>
                  <h3>{groupTitle(g.title)}</h3>
                  <div className="rows">{g.entries.map((e) => <PersonRow key={e.person.id} ds={scoped} p={e.person} relation={relLabel(e.label)} right={<StandingPill ds={scoped} personId={e.person.id} />} onClick={() => setPersonId(e.person.id)} />)}</div>
                </div>
              ))}
            </>
          ) : gens.map((g) => (
            <div className="card" key={g}>
              <h3>{g === 0 ? `${owner}'s generation` : g > 0 ? `${g === 1 ? 'Parents' : g === 2 ? 'Grandparents' : g === 3 ? 'Great-grandparents' : `Generation ${g}`}` : 'Children'}</h3>
              <div className="rows">{scoped.people.filter((p) => p.generation === g).map((p) => <PersonRow key={p.id} ds={scoped} p={p} right={<StandingPill ds={scoped} personId={p.id} />} onClick={() => setPersonId(p.id)} />)}</div>
            </div>
          ))}
          {can.contribute && <div className="card"><h3>Know someone who should be on this?</h3><p className="muted">A brother or sister, a cousin, an aunt. Tell {owner} who they are and they will get their own link, with the tree centered on them.</p><button className="btn" onClick={() => setSuggesting(true)}>Suggest someone to invite</button></div>}
          {can.contribute && <div className="card"><h3>Something that fits nowhere above?</h3><p className="muted">A note about the whole family, a lead, a photo you have, or a story you would rather tell in your own order.</p><button className="btn primary" onClick={() => setPersonId('__branch')}>Add a general note</button></div>}
        </div>
      )}
      {tab === 'people' && (person || personId === '__branch') && (
        <Contribute key={(person?.id ?? 'branch') + (startKind ?? '')} scoped={scoped} person={person ?? null} meId={me?.id} whose={whose} inv={inv} canContribute={can.contribute} startKind={startKind} onBack={() => { setPersonId(null); setStartKind(null); }} api={api} token={token} deviceId={deviceId} onSubmitted={refreshScoped} onRequest={() => askForLink(person ? { message: `About ${displayName(person)}.` } : undefined)} />
      )}
    </main>
  );
}

function RequestAccess({ reason, owner, onSubmit, suggest, onCancel, initial }: { reason: string; owner: string; onSubmit: (r: Omit<AccessRequestInput, 'deviceHash' | 'viaInvitationId'>) => Promise<void>; suggest?: boolean; onCancel?: () => void; initial?: { name?: string; relationship?: string; message?: string } }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [relationship, setRelationship] = useState(initial?.relationship ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await onSubmit({ name: name.trim(), relationship: relationship.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, message: message.trim() || undefined }); } finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ marginTop: 40 }}>
      <h1>{suggest ? 'Suggest someone to invite' : 'Ask for your own link'}</h1>
      <p className="muted">{reason}{suggest ? '' : ` Each family member gets a personal link and a code, sent by ${owner}. Tell ${owner} how to reach you.`}</p>
      <div className="form-grid">
        <label className="field">{suggest ? 'Their name' : 'Your name'}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">{suggest ? 'How they are related to you' : 'How you are related'}<input value={relationship} onChange={(e) => setRelationship(e.target.value)} placeholder={suggest ? 'my sister, my cousin' : `${owner}'s aunt, Mom's brother`} /></label>
        <label className="field">{suggest ? 'Their email (if you know it)' : 'Email'}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">{suggest ? 'Their phone (if you know it)' : 'Phone'}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      </div>
      <label className="field" style={{ marginTop: 10 }}>Anything to add (optional)<textarea value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={send} disabled={busy || !name.trim() || !relationship.trim() || !(email.trim() || phone.trim())}>{suggest ? 'Send suggestion' : 'Ask for my link'}</button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function Contribute({ scoped, person, meId, whose, inv, canContribute, startKind, onBack, api, token, deviceId, onSubmitted, onRequest }: { scoped: Dataset; person: Person | null; meId?: string; whose?: string; inv: Invitation; canContribute: boolean; startKind: ContributionKind | null; onBack: () => void; api: InviteApi; token: string; deviceId: string; onSubmitted: () => Promise<void>; onRequest: () => void }) {
  const [kind, setKind] = useState<ContributionKind | null>(startKind);
  const rawRelation = person && meId && person.id !== meId ? howRelated(scoped, person.id, meId).label : person && meId ? 'you' : '';
  const relation = rawRelation.replace(/ \(through (.+)\)$/, (_m, name: string) => { const via = scoped.people.find((x) => displayName(x) === name); return ` · through ${via ? via.givenNames.split(' ')[0] : name}`; });
  const [text, setText] = useState('');
  const [why, setWhy] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [files, setFiles] = useState<(UploadedFile & { previewUrl?: string })[]>([]);
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
        setFiles((x) => [...x, { ...up, previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }]);
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
      <div><button className="btn small" onClick={onBack}>← Back</button></div>
      {person && (
        <div className="card">
          <h2>{displayName(person)}</h2>
          {relation && <p className="rel-label" style={{ marginTop: -6 }}>{relation === 'you' ? (whose === 'your' ? 'This is you.' : `This is ${inv.recipientName.split(' ')[0]}.`) : `${whose === 'your' ? 'Your' : whose} ${relation}.`}</p>}
          <p className="row"><ConfidencePill c={person.confidence} /><span className="pill">{lifespan(scoped, person) || 'no dates recorded'}</span></p>
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
      {person && <StandingCard ds={scoped} person={person} myId={inv.id} canAttest={canContribute} onAttest={async (stance, note, field) => { const r = await api.attest(token, deviceId, person.id, stance, note, field); if (r.ok) await onSubmitted(); return r.ok; }} />}
      {sent && <div className="banner ok" role="status">Sent. It goes to {ownerName(scoped)} to review before it becomes part of the record. Add more whenever you like.</div>}
      {!canContribute && <div className="card"><h3>Know something about {person ? person.givenNames.split(' ')[0] : 'the family'}?</h3><p className="muted">A memory, a correction, a photo, where they lived. Adding needs a link of your own, personal to you, and it takes {ownerName(scoped)} a minute to send one.</p><button className="btn primary" onClick={onRequest}>Ask for my own link</button></div>}
      {canContribute && !kind && (
        <div className="card">
          <h3>{person ? `Add to ${person.givenNames.split(' ')[0]}'s story` : 'Add a general note'}</h3>
          <div className="tiles">{KINDS.filter((k) => (person ? k.kind !== 'branch-note' : ['branch-note', 'lead', 'context', 'identify-photo', 'missing-person', 'oral-history'].includes(k.kind))).map((k) => <button key={k.kind + k.label} className="tile" onClick={() => setKind(k.kind)}><strong>{k.label}</strong><span>{k.prompt.length > 70 ? k.prompt.slice(0, 68).replace(/\s\S*$/, '') + '…' : k.prompt}</span></button>)}</div>
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
            {files.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none' }} className="stack">{files.map((f) => <li key={f.id} className="row" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 8 }}>{f.previewUrl ? <img src={f.previewUrl} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} /> : <span className="pill">{f.kind}</span>}<span>{f.name} <small className="muted">({Math.max(1, Math.round(f.size / 1024))} KB)</small></span></span><button className="btn small ghost" type="button" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>Remove</button></li>)}</ul>}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>Your name is attached as "{inv.recipientName}" so {ownerName(scoped)} can follow up. Only the admin sees submissions until they are approved. Files you attach stay private to the family archive.</p>
          <div className="row"><button className="btn primary" onClick={submit} disabled={sending || (!text.trim() && !Object.values(fields).some((v) => v.trim()) && files.length === 0)}>{sending ? 'Sending…' : `Send to ${ownerName(scoped)}`}</button><button className="btn" onClick={() => setKind(null)}>Back</button></div>
        </div>
      )}
    </div>
  );
}


/** "Find yourself": a look-only visitor picks who they are and the whole page re-centers on them. */
function ViewAs({ scoped, owner, onPick, onNotHere }: { scoped: Dataset; owner: string; onPick: (id: string) => void; onNotHere: () => void }) {
  const [q, setQ] = useState('');
  const people = scoped.people.filter((p) => !p.placeholder);
  const living = people.filter((p) => p.living !== 'no');
  const needle = q.trim().toLowerCase();
  const hits = needle ? people.filter((p) => `${p.givenNames} ${p.surname} ${p.maidenName ?? ''} ${(p.altNames ?? []).join(' ')}`.toLowerCase().includes(needle)).slice(0, 8) : living.slice(0, 8);
  return (
    <div className="card raised" style={{ marginBottom: 18 }}>
      <h3 style={{ marginTop: 0 }}>See it from where you stand</h3>
      <p className="muted" style={{ marginTop: 4 }}>Pick yourself and the tree re-centers on you: your parents and grandparents, your children, your side of the family, and the blanks only you can fill. Nothing changes for anyone else.</p>
      <label className="field">Your name<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing" autoComplete="off" /></label>
      <div className="row" style={{ marginTop: 8 }}>
        {hits.map((p) => <button key={p.id} className="chip" onClick={() => onPick(p.id)}>{p.givenNames.split(' ')[0]} {p.surname}{p.maidenName && p.maidenName !== p.surname ? ` (née ${p.maidenName})` : ''}</button>)}
        {needle && hits.length === 0 && <span className="muted">Nobody by that name yet.</span>}
      </div>
      <p className="muted" style={{ margin: '10px 0 0' }}>Not in the tree yet? <button className="btn small" onClick={onNotHere}>Ask {owner} for a link</button></p>
    </div>
  );
}
