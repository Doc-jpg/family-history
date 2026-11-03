import { useEffect, useMemo, useRef, useState } from 'react';
import { standingOf } from '../model/standing';
import * as d3 from 'd3';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import type { Dataset, Person } from '../model/types';
import { childrenOf, displayName, howRelated, parentsOf, partnersOf } from '../model/graph';
import { branchColor, ConfidencePill, lifespan } from '../components/PersonBits';

interface TNode { p: Person; children?: TNode[]; up: boolean }

function buildUp(ds: Dataset, p: Person, collapsed: Set<string>, show: (p: Person) => boolean, seen = new Set<string>()): TNode {
  seen.add(p.id);
  const node: TNode = { p, up: true };
  if (!collapsed.has(p.id)) {
    const parents = parentsOf(ds, p.id).filter(show).filter((x) => !seen.has(x.id));
    if (parents.length) node.children = parents.map((x) => buildUp(ds, x, collapsed, show, seen));
  }
  return node;
}
function buildDown(ds: Dataset, p: Person, collapsed: Set<string>, show: (p: Person) => boolean, seen = new Set<string>()): TNode {
  seen.add(p.id);
  const node: TNode = { p, up: false };
  if (!collapsed.has(p.id)) {
    const kids = childrenOf(ds, p.id).filter(show).filter((x) => !seen.has(x.id));
    if (kids.length) node.children = kids.map((x) => buildDown(ds, x, collapsed, show, seen));
  }
  return node;
}

export default function TreeView({ data, onOpen, rootId }: { data?: Dataset; onOpen?: (id: string) => void; rootId?: string } = {}) {
  const store = useStore();
  const ds = data ?? store.ds;
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [branch, setBranch] = useState<'all' | 'paternal' | 'maternal'>('all');
  const [hideSlots, setHideSlots] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pathEnds, setPathEnds] = useState<string[]>([]);
  const [mode, setMode] = useState<'hourglass' | 'descendants'>('hourglass');
  const rootPerson = (rootId && ds.people.find((p) => p.id === rootId)) || ds.people.find((p) => p.id === ds.settings.rootPersonId)!;
  const heads = ds.people.filter((p) => !p.placeholder && childrenOf(ds, p.id).length > 0).sort((a, b) => b.generation - a.generation || displayName(a).localeCompare(displayName(b)));
  const [headId, setHeadId] = useState<string>(() => heads.find((p) => p.generation === Math.max(...heads.map((h) => h.generation)))?.id ?? rootPerson.id);
  const root = mode === 'descendants' ? ds.people.find((p) => p.id === headId) ?? rootPerson : rootPerson;

  const show = (p: Person) => {
    if (hideSlots && p.placeholder) return false;
    if (branch !== 'all' && p.branch !== branch && p.branch !== 'self' && p.branch !== 'both' && p.branch !== 'household') return false;
    return true;
  };

  const highlight = useMemo(() => {
    if (pathEnds.length !== 2) return new Set<string>();
    return new Set(howRelated(ds, pathEnds[0], pathEnds[1]).path);
  }, [ds, pathEnds]);

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    const g = d3.select(gRef.current!);
    g.selectAll('*').remove();
    const W = svgRef.current!.clientWidth || 1000;
    const H = svgRef.current!.clientHeight || 700;
    const dx = 170, dy = 120;

    const up = d3.hierarchy(mode === 'descendants' ? { p: root, up: true } : buildUp(ds, root, collapsed, show));
    const down = d3.hierarchy(buildDown(ds, root, collapsed, show));
    const layout = d3.tree<TNode>().nodeSize([dx, dy]).separation((a, b) => (a.parent === b.parent ? 1 : 1.25));
    layout(up);
    layout(down);

    type N = d3.HierarchyPointNode<TNode>;
    const nodes: N[] = [];
    const links: { s: N; t: N; status: string }[] = [];
    (up as N).each((n) => { n.y = -n.depth * dy; nodes.push(n); });
    (down as N).each((n) => { n.y = n.depth * dy; if (n.depth > 0) nodes.push(n); });
    const relStatus = (a: string, b: string) => ds.relationships.find((r) => r.type === 'parent-child' && ((r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a)))?.status ?? 'unverified';
    (up as N).links().forEach((l) => links.push({ s: l.source as N, t: l.target as N, status: relStatus(l.source.data.p.id, l.target.data.p.id) }));
    (down as N).links().forEach((l) => links.push({ s: l.source as N, t: l.target as N, status: relStatus(l.source.data.p.id, l.target.data.p.id) }));

    const matches = query.trim().toLowerCase();

    g.append('g').selectAll('path').data(links).join('path')
      .attr('class', (d) => `link ${d.status}${highlight.has(d.s.data.p.id) && highlight.has(d.t.data.p.id) ? ' highlight' : ''}`)
      .attr('d', (d) => `M${d.s.x},${d.s.y}C${d.s.x},${(d.s.y + d.t.y) / 2} ${d.t.x},${(d.s.y + d.t.y) / 2} ${d.t.x},${d.t.y}`);

    const node = g.append('g').selectAll('g').data(nodes).join('g')
      .attr('class', (d) => { const st = standingOf(ds, d.data.p.id).standing; return `node${d.data.p.placeholder ? ' placeholder' : ''}${d.data.p.living === 'no' ? ' deceased' : ''}${st === 'pencil' ? ' pencil' : st === 'disputed' ? ' disputed' : ''}`; })
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')
      .on('click', (ev: MouseEvent, d) => {
        if (ev.shiftKey) setPathEnds((pe) => (pe.length >= 2 ? [d.data.p.id] : [...pe, d.data.p.id]));
        else setSelected(d.data.p.id);
      });

    node.append('circle').attr('class', 'ring').attr('r', 22)
      .attr('stroke', (d) => branchColor(d.data.p.branch))
      .attr('opacity', (d) => (matches && !displayName(d.data.p).toLowerCase().includes(matches) ? 0.25 : 1))
      .attr('fill', (d) => (highlight.has(d.data.p.id) ? 'color-mix(in srgb, var(--accent) 25%, var(--paper))' : 'var(--paper)'));
    node.append('text').attr('text-anchor', 'middle').attr('dy', 5).attr('font-size', 16)
      .text((d) => (d.data.p.placeholder ? '?' : d.data.p.givenNames.slice(0, 1) + (d.data.p.surname.slice(0, 1) || '')));
    node.filter((d) => d.data.p.living === 'no').append('text').attr('x', 18).attr('y', -14).attr('font-size', 11).attr('fill', 'var(--ink-3)').text('✝');
    node.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('y', 38).text((d) => (d.data.p.placeholder ? d.data.p.givenNames.replace(' (name needed)', '') : d.data.p.givenNames));
    node.append('text').attr('class', 'name').attr('text-anchor', 'middle').attr('y', 52).text((d) => (d.data.p.placeholder ? '' : d.data.p.surname + (d.data.p.maidenName && d.data.p.maidenName !== d.data.p.surname ? ` (née ${d.data.p.maidenName})` : '')));
    node.append('text').attr('class', 'years').attr('text-anchor', 'middle').attr('y', 66).text((d) => lifespan(ds, d.data.p));
    // partners
    node.each(function (d) {
      const partners = partnersOf(ds, d.data.p.id).filter((x) => !nodes.some((n) => n.data.p.id === x.person.id));
      if (!partners.length) return;
      d3.select(this).append('text').attr('class', 'years').attr('text-anchor', 'middle').attr('y', 79)
        .text('⚭ ' + partners.map((x) => displayName(x.person)).join(', '));
    });
    // expand/collapse toggles
    node.filter((d) => (d.data.up ? parentsOf(ds, d.data.p.id).some(show) : childrenOf(ds, d.data.p.id).some(show)) && d.data.p.id !== root.id || (d.data.p.id === root.id && false))
      .append('circle').attr('r', 7).attr('cy', (d) => (d.data.up ? -28 : 92)).attr('fill', 'var(--paper-2)').attr('stroke', 'var(--line)')
      .on('click', (ev: MouseEvent, d) => { ev.stopPropagation(); setCollapsed((c) => { const n = new Set(c); n.has(d.data.p.id) ? n.delete(d.data.p.id) : n.add(d.data.p.id); return n; }); });
    node.filter((d) => (d.data.up ? parentsOf(ds, d.data.p.id).some(show) : childrenOf(ds, d.data.p.id).some(show)) && d.data.p.id !== root.id)
      .append('text').attr('text-anchor', 'middle').attr('y', (d) => (d.data.up ? -24 : 96)).attr('font-size', 11).text((d) => (collapsed.has(d.data.p.id) ? '+' : '−'));

    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 2.5]).on('zoom', (ev) => g.attr('transform', ev.transform));
    svg.call(zoom);
    const ys = nodes.map((n) => n.y), xs = nodes.map((n) => n.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const k = Math.min(1, (W - 80) / (Math.max(...xs) - Math.min(...xs) + dx), (H - 200) / (Math.max(...ys) - Math.min(...ys) + dy));
    svg.call(zoom.transform, d3.zoomIdentity.translate(W / 2 - cx * k, H / 2 - cy * k + 30).scale(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, collapsed, branch, hideSlots, query, highlight, mode, root]);

  const sel = selected ? ds.people.find((p) => p.id === selected) : null;
  return (
    <main className={data ? undefined : "page wide"} style={data ? { height: "100%" } : undefined}>
      <div className={`viz${data ? " embedded" : ""}`}>
        <div className="viz-toolbar">
          <div className="panel row">
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="hourglass">Ancestors and descendants of {rootPerson.givenNames.split(' ')[0]}</option>
              <option value="descendants">Everyone descended from…</option>
            </select>
            {mode === 'descendants' && <select value={headId} onChange={(e) => setHeadId(e.target.value)}>{heads.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}</select>}
            <select value={branch} onChange={(e) => setBranch(e.target.value as typeof branch)}>
              <option value="all">Both sides</option>
              <option value="paternal">Paternal only</option>
              <option value="maternal">Maternal only</option>
            </select>
            <input placeholder="Find a name" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="check"><input type="checkbox" checked={hideSlots} onChange={(e) => setHideSlots(e.target.checked)} /> Hide empty slots</label>
          </div>
          <div className="panel legend">
            <span><i className="sw" style={{ background: 'var(--paternal)' }} />Paternal</span>
            <span><i className="sw" style={{ background: 'var(--maternal)' }} />Maternal</span>
            <span><i className="sw" style={{ background: 'var(--self)' }} />You</span>
            <span><i className="sw" style={{ background: 'var(--household)' }} />Household</span>
            <span className="muted">dashed ring = slot · dotted ring = pencil (one voice) · red = under question · dashed line = unverified</span>
          </div>
          <div className="panel muted" style={{ fontSize: '0.85rem' }}>
            Click a person for details. Shift-click two people to highlight how they connect.{pathEnds.length === 2 && <> <strong>{howRelated(ds, pathEnds[0], pathEnds[1]).label}</strong> <button className="btn small" onClick={() => setPathEnds([])}>clear</button></>}
          </div>
        </div>
        <svg ref={svgRef}><g ref={gRef} /></svg>
        {sel && (
          <aside className="drawer">
            <button className="btn small close" onClick={() => setSelected(null)}>Close</button>
            <h2 style={{ color: branchColor(sel.branch) }}>{displayName(sel)}</h2>
            <p className="row"><ConfidencePill c={sel.confidence} /> <span className="pill">{sel.branch}</span> <span className="pill">{sel.living === 'yes' ? 'living' : sel.living === 'no' ? 'deceased' : 'living status unknown'}</span></p>
            {sel.placeholder ? (
              <p className="muted">This is a slot waiting on facts. Nothing is recorded or assumed about this person yet.</p>
            ) : (
              <p>{sel.bio ?? <span className="muted">No biography yet.</span>}</p>
            )}
            <dl className="kv">
              <dt>Lifespan</dt><dd>{lifespan(ds, sel) || '—'}</dd>
              <dt>Parents</dt><dd>{parentsOf(ds, sel.id).map((p) => displayName(p)).join(', ') || '—'}</dd>
              <dt>Partners</dt><dd>{partnersOf(ds, sel.id).map((x) => displayName(x.person)).join(', ') || '—'}</dd>
              <dt>Children</dt><dd>{childrenOf(ds, sel.id).map((p) => displayName(p)).join(', ') || '—'}</dd>
            </dl>
            {sel.openQuestions?.length ? (<><h3 style={{ marginTop: 16 }}>Open questions</h3>{sel.openQuestions.map((q) => <div className="question" key={q}>{q}</div>)}</>) : null}
            <p style={{ marginTop: 16 }}>{onOpen ? <button className="btn primary" onClick={() => onOpen(sel.id)}>Full profile</button> : <Link className="btn primary" to={`/person/${sel.id}`}>Full profile</Link>}</p>
          </aside>
        )}
      </div>
    </main>
  );
}
