import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Dataset, Person } from '../model/types';
import { birthYear, deathYear, displayName } from '../model/graph';

export function branchColor(branch: Person['branch']): string {
  return `var(--${branch === 'both' ? 'accent' : branch})`;
}

export function lifespan(ds: Dataset, p: Person): string {
  const b = birthYear(ds, p.id);
  const d = deathYear(ds, p.id);
  if (!b && !d) return p.living === 'yes' ? 'living' : p.living === 'no' ? 'deceased' : '';
  return `${b ?? '?'} – ${p.living === 'yes' ? 'living' : d ?? '?'}`;
}

export function ConfidencePill({ c }: { c: Person['confidence'] }) {
  const cls = c === 'verified' ? 'ok' : c === 'likely' ? '' : c === 'tentative' ? 'warn' : 'bad';
  return <span className={`pill ${cls}`}>{c}</span>;
}

/** Initials in a ring colored by branch; a photo when one is attached (admin view resolves it elsewhere). */
export function Avatar({ p, size = 'md', src }: { p: Person; size?: 'sm' | 'md' | 'lg'; src?: string | null }) {
  const initials = p.placeholder ? '?' : (p.givenNames.slice(0, 1) + (p.surname.slice(0, 1) || '')).toUpperCase();
  return <span className={`avatar ${size}`} style={{ borderColor: branchColor(p.branch), color: p.placeholder ? 'var(--ink-3)' : branchColor(p.branch) }} aria-hidden="true">{src ? <img src={src} alt="" /> : initials}</span>;
}

export function PersonChip({ ds, p, to = true }: { ds: Dataset; p: Person; to?: boolean }) {
  const inner = (
    <span className="row" style={{ gap: 8 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: branchColor(p.branch), display: 'inline-block', outline: p.placeholder ? '2px dashed ' + branchColor(p.branch) : 'none', outlineOffset: 2, opacity: p.placeholder ? 0.5 : 1 }} />
      <span style={{ fontWeight: 600, fontStyle: p.placeholder ? 'italic' : 'normal' }}>{displayName(p)}</span>
      <small className="muted">{lifespan(ds, p)}</small>
    </span>
  );
  return to ? <Link to={`/person/${p.id}`} style={{ textDecoration: 'none' }}>{inner}</Link> : inner;
}

/** A list row for a person: avatar, name and years, an optional relation line, a slot on the right. */
export function PersonRow({ ds, p, relation, right, onClick }: { ds: Dataset; p: Person; relation?: string; right?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="person-row" onClick={onClick}>
      <Avatar p={p} size="sm" />
      <span className="person-row-main">
        <span className="person-row-name">{displayName(p)}</span>
        <span className="person-row-sub">{[lifespan(ds, p), relation].filter(Boolean).join(' · ')}</span>
      </span>
      {right && <span className="person-row-right">{right}</span>}
    </button>
  );
}
