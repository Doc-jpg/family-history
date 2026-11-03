import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { birthYear, deathYear, displayName, formatDate } from '../model/graph';
import { CONTEXT_EVENTS } from '../lib/context-events';
import { branchColor } from '../components/PersonBits';
import type { Person } from '../model/types';

export default function TimelineView() {
  const { ds } = useStore();
  const [scope, setScope] = useState<'all' | 'paternal' | 'maternal' | string>('all');
  const now = new Date().getFullYear();
  const people = ds.people.filter((p) => !p.placeholder).filter((p) => scope === 'all' || (scope === 'paternal' || scope === 'maternal' ? p.branch === scope || p.branch === 'self' || p.branch === 'both' : p.id === scope));
  const known = people.map((p) => ({ p, b: birthYear(ds, p.id), d: deathYear(ds, p.id) }));
  const years = [...known.map((k) => k.b), ...known.map((k) => k.d), ...ds.events.map((e) => e.date?.year)].filter((y): y is number => !!y);
  const minY = Math.min(...(years.length ? years : [1900]), 1850) - 5;
  const [year, setYear] = useState<number>(now);
  const W = 960, left = 180, right = 20, rowH = 34;
  const x = (y: number) => left + ((y - minY) / (now - minY)) * (W - left - right);
  const gens = useMemo(() => [...new Set(known.map((k) => k.p.generation))].sort((a, b) => b - a), [known]);
  const rows = gens.flatMap((g) => known.filter((k) => k.p.generation === g).sort((a, b) => (a.b ?? 9999) - (b.b ?? 9999)));
  const H = 40 + rows.length * rowH + 20;
  const ctx = CONTEXT_EVENTS.filter((c) => c.from <= year && (c.to ?? c.from) >= year - 2);
  const alive = known.filter((k) => k.b != null && k.b <= year && (k.p.living === 'yes' || k.d == null || k.d >= year));
  const whereIn = (p: Person) => {
    const res = ds.events.filter((e) => e.personIds.includes(p.id) && e.placeId && (e.type === 'residence' || e.type === 'birth') && (e.date?.year ?? 0) <= year).sort((a, b) => (b.date?.year ?? 0) - (a.date?.year ?? 0))[0];
    return res ? ds.places.find((pl) => pl.id === res.placeId)?.name : undefined;
  };
  const ticks: number[] = [];
  for (let y = Math.ceil(minY / 10) * 10; y <= now; y += 10) ticks.push(y);

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1>Timeline</h1>
          <p className="muted">Lifespans by generation. Drag the year to see the family at that moment.</p>
        </div>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Whole family</option>
          <option value="paternal">Paternal branch</option>
          <option value="maternal">Maternal branch</option>
          {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)} only</option>)}
        </select>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 20 }}>
          <span className="tl-year">{year}</span>
          <input type="range" min={minY + 5} max={now} value={year} onChange={(e) => setYear(+e.target.value)} style={{ flex: 1 }} />
          <div className="row">{[1850, 1900, 1950, 2000].filter((y) => y >= minY).map((y) => <button key={y} className="btn small" onClick={() => setYear(y)}>{y}</button>)}<button className="btn small" onClick={() => setYear(now)}>now</button></div>
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h3>The family in {year}</h3>
            {alive.length === 0 ? <p className="muted">Nobody with a known birth year was alive in {year} yet, as far as the record goes.</p> : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {alive.map((k) => <li key={k.p.id}><Link to={`/person/${k.p.id}`}>{displayName(k.p)}</Link>, age {year - k.b!}{whereIn(k.p) ? `, ${whereIn(k.p)}` : ''}</li>)}
              </ul>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h3>Around them <small className="muted">(general context, not family record)</small></h3>
            <div className="row">{ctx.length ? ctx.map((c) => <span key={c.title} className="context-chip">{c.from}{c.to ? `–${c.to}` : ''}: {c.title}</span>) : <span className="muted">Nothing listed for this year.</span>}</div>
          </div>
        </div>
      </div>
      <div className="card timeline-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 700 }}>
          {ticks.map((t) => <g key={t}><line x1={x(t)} x2={x(t)} y1={20} y2={H - 10} stroke="var(--line)" /><text x={x(t)} y={14} fontSize={11} textAnchor="middle" fill="var(--ink-3)">{t}</text></g>)}
          <line x1={x(year)} x2={x(year)} y1={16} y2={H - 10} stroke="var(--accent)" strokeWidth={2} />
          {rows.map((k, i) => {
            const y = 40 + i * rowH;
            const start = k.b ?? minY;
            const end = k.p.living === 'yes' ? now : k.d ?? now;
            const unknownStart = k.b == null, unknownEnd = k.p.living !== 'yes' && k.d == null;
            const evs = ds.events.filter((e) => e.personIds.includes(k.p.id) && e.date?.year && e.type !== 'birth' && e.type !== 'death');
            return (
              <g key={k.p.id}>
                <text x={left - 10} y={y + 5} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--ink)">{displayName(k.p)}</text>
                <text x={left - 10} y={y + 18} textAnchor="end" fontSize={10} fill="var(--ink-3)">gen {k.p.generation === 0 ? 'self' : k.p.generation}</text>
                {unknownStart ? (
                  <text x={left + 4} y={y + 4} fontSize={11} fill="var(--ink-3)" fontStyle="italic">no birth year recorded{k.p.living === 'yes' ? ' (living)' : ''}</text>
                ) : (
                  <>
                    <rect x={x(start)} y={y - 7} width={Math.max(2, x(end) - x(start))} height={14} rx={7} fill={branchColor(k.p.branch)} opacity={0.75} strokeDasharray={unknownEnd ? '4 3' : undefined} stroke={branchColor(k.p.branch)} />
                    {evs.map((e) => <circle key={e.id} cx={x(e.date!.year!)} cy={y} r={4} fill="var(--paper)" stroke="var(--ink)"><title>{e.type}: {formatDate(e.date)} {e.description ?? ''}</title></circle>)}
                    {unknownEnd && <text x={x(end) + 4} y={y + 4} fontSize={10} fill="var(--ink-3)">death ?</text>}
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {rows.length === 0 && <p className="empty">No people with dates in this scope yet.</p>}
        <p className="muted" style={{ marginTop: 8 }}>Dashed bars are missing a birth or death year. {ds.people.filter((p) => p.placeholder).length} unnamed slots are not shown until they have a name.</p>
      </div>
    </main>
  );
}
