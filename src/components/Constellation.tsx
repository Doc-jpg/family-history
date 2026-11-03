import { useMemo } from 'react';
import type { Dataset } from '../model/types';

// The family as a small night sky: one point per person, placed by generation (oldest at the
// top) and spread by branch, with parent-child lines. Purely decorative, drawn from the real data,
// so it grows as the tree grows.
export default function Constellation({ ds, className }: { ds: Dataset; className?: string }) {
  const { points, links } = useMemo(() => {
    const people = ds.people.filter((p) => !p.placeholder);
    const gens = [...new Set(people.map((p) => p.generation))].sort((a, b) => b - a);
    const W = 400, H = 300, padX = 24, padY = 18;
    const rowY = (g: number) => padY + (gens.indexOf(g) / Math.max(1, gens.length - 1)) * (H - padY * 2);
    const order: Record<string, number> = { paternal: 0, both: 1, self: 1, household: 1, unknown: 2, maternal: 3 };
    const pts = new Map<string, { x: number; y: number; branch: string; dead: boolean }>();
    for (const g of gens) {
      const row = people.filter((p) => p.generation === g).sort((a, b) => (order[a.branch] ?? 2) - (order[b.branch] ?? 2) || a.id.localeCompare(b.id));
      row.forEach((p, i) => {
        // Deterministic jitter so it reads as a sky, not a chart.
        const h = [...p.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
        const jx = ((h % 17) - 8) * 0.9, jy = (((h >> 5) % 13) - 6) * 1.6;
        const x = padX + ((i + 0.5) / row.length) * (W - padX * 2) + jx;
        pts.set(p.id, { x, y: rowY(g) + jy, branch: p.branch, dead: p.living === 'no' });
      });
    }
    const ls = ds.relationships.filter((r) => r.type === 'parent-child' && pts.has(r.fromId) && pts.has(r.toId)).map((r) => ({ a: pts.get(r.fromId)!, b: pts.get(r.toId)! }));
    return { points: [...pts.entries()], links: ls };
  }, [ds]);
  return (
    <svg className={className} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {links.map((l, i) => <line key={i} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="rgba(241,245,241,0.16)" strokeWidth="1" />)}
      {points.map(([id, p], i) => (
        <circle key={id} cx={p.x} cy={p.y} r={p.branch === 'self' ? 5 : 3.2} fill={`var(--${p.branch === 'both' ? 'accent' : p.branch})`} opacity={p.dead ? 0.75 : 1} style={{ animationDelay: `${(i % 23) * 40}ms`, transformOrigin: `${p.x}px ${p.y}px` }} />
      ))}
    </svg>
  );
}
