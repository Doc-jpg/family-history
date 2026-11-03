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
