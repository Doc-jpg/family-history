import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useStore } from '../store/store';
import { displayName, formatDate } from '../model/graph';
import type { LifeEvent } from '../model/types';

// Markers for every placed event; polylines joining one person's events in date order
// (birth → residences → death) so a branch's movement reads as a route.
// Solid = all points verified. Dashed = any point tentative or unresearched.

export default function MapView() {
  const { ds } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [branch, setBranch] = useState<'all' | 'paternal' | 'maternal'>('all');
  // Story mode: follow one person's placed events in date order, one stop at a time.
  const [journeyId, setJourneyId] = useState('');
  const [stop, setStop] = useState(0);

  const placed = useMemo(() => ds.events.filter((e) => e.placeId && ds.places.find((p) => p.id === e.placeId)?.lat != null), [ds]);
  const years = placed.map((e) => e.date?.year).filter((y): y is number => !!y);
  const minY = years.length ? Math.min(...years) : 1900;
  const maxY = new Date().getFullYear();

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, { zoomControl: true }).setView([38.5, -95], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const color = (b: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${b === 'both' ? 'accent' : b}`).trim() || '#555';
    const keep = (e: LifeEvent) => {
      if (year && e.date?.year && e.date.year > year) return false;
      if (branch === 'all') return true;
      return e.personIds.some((id) => { const p = ds.people.find((x) => x.id === id); return p && (p.branch === branch || p.branch === 'self' || p.branch === 'both'); });
    };
    const evs = placed.filter(keep);
    const bounds: L.LatLngExpression[] = [];
    for (const e of evs) {
      const pl = ds.places.find((p) => p.id === e.placeId)!;
      const people = e.personIds.map((id) => ds.people.find((p) => p.id === id)).filter(Boolean);
      const b = people[0]?.branch ?? 'unknown';
      const m = L.circleMarker([pl.lat!, pl.lng!], { radius: 8, color: color(b), fillColor: color(b), fillOpacity: e.confidence === 'verified' ? 0.9 : 0.4, weight: 2, dashArray: e.confidence === 'verified' ? undefined : '3 3' });
      m.bindPopup(`<strong>${people.map((p) => displayName(p!)).join(', ')}</strong><br>${e.type} · ${formatDate(e.date) || 'date unknown'}<br>${pl.name}<br><small>${e.confidence}${e.sourceIds.length ? ' · sourced' : ' · no source yet'}</small>`);
      m.addTo(layer);
      bounds.push([pl.lat!, pl.lng!]);
    }
    // routes per person
    for (const p of ds.people) {
      const mine = evs.filter((e) => e.personIds.includes(p.id) && e.date?.year).sort((a, b) => a.date!.year! - b.date!.year!);
      if (mine.length < 2) continue;
      const pts = mine.map((e) => { const pl = ds.places.find((x) => x.id === e.placeId)!; return [pl.lat!, pl.lng!] as L.LatLngExpression; });
      const verified = mine.every((e) => e.confidence === 'verified');
      L.polyline(pts, { color: color(p.branch), weight: 2.5, opacity: 0.8, dashArray: verified ? undefined : '6 6' }).bindTooltip(`${displayName(p)}: ${mine.map((e) => e.date!.year).join(' → ')}`).addTo(layer);
    }
    if (bounds.length) {
      const us = bounds.filter((b) => (b as [number, number])[1] < -50);
      map.fitBounds(L.latLngBounds(us.length ? us : bounds).pad(0.25), { maxZoom: 6 });
    }
  }, [ds, placed, year, branch]);

  const unplaced = ds.events.filter((e) => e.placeId && ds.places.find((p) => p.id === e.placeId)?.lat == null);
  const journeys = ds.people.filter((p) => !p.placeholder && placed.filter((e) => e.personIds.includes(p.id) && e.date?.year).length >= 2);
  const journey = journeyId ? placed.filter((e) => e.personIds.includes(journeyId) && e.date?.year).sort((a, b) => a.date!.year! - b.date!.year!) : [];
  const traveler = ds.people.find((p) => p.id === journeyId);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !journey.length) return;
    const e = journey[Math.min(stop, journey.length - 1)];
    const pl = ds.places.find((x) => x.id === e.placeId)!;
    map.flyTo([pl.lat!, pl.lng!], 7, { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journeyId, stop]);
  const current = journey.length ? journey[Math.min(stop, journey.length - 1)] : null;
  return (
    <main className="page wide">
      <div className="viz">
        <div className="map-wrap" ref={ref} />
        <div className="viz-toolbar">
          <div className="panel row">
            <select value={branch} onChange={(e) => setBranch(e.target.value as typeof branch)}>
              <option value="all">Both sides</option><option value="paternal">Paternal</option><option value="maternal">Maternal</option>
            </select>
            <label className="row" style={{ gap: 6 }}>Up to year
              <input type="range" min={minY} max={maxY} value={year ?? maxY} onChange={(e) => setYear(+e.target.value)} />
              <strong>{year ?? 'now'}</strong>
              {year && <button className="btn small" onClick={() => setYear(null)}>all</button>}
            </label>
          </div>
          <div className="panel row">
            <select value={journeyId} onChange={(e) => { setJourneyId(e.target.value); setStop(0); }} aria-label="Follow a journey">
              <option value="">Follow a journey…</option>
              {journeys.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
            {journey.length > 0 && <>
              <button className="btn small" onClick={() => setStop((s) => Math.max(0, s - 1))} disabled={stop === 0}>Back</button>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.min(stop, journey.length - 1) + 1} / {journey.length}</strong>
              <button className="btn small primary" onClick={() => setStop((s) => Math.min(journey.length - 1, s + 1))} disabled={stop >= journey.length - 1}>Next</button>
              <button className="btn small ghost" onClick={() => setJourneyId('')}>Done</button>
            </>}
          </div>
          <div className="panel hint">
            {placed.length} placed event{placed.length === 1 ? '' : 's'}. Solid = verified, faded or dashed = not yet verified.{unplaced.length ? ` ${unplaced.length} with a place but no map point yet.` : ''}
          </div>
        </div>
        {current && traveler && (
          <div className="card raised" style={{ position: 'absolute', left: 14, right: 14, bottom: 14, zIndex: 1000, maxWidth: 520, margin: '0 auto' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><strong>{displayName(traveler)}</strong><span className="pill">{current.date?.year}</span></div>
            <p style={{ margin: '4px 0 0' }}><strong style={{ textTransform: 'capitalize' }}>{current.type}</strong> in {ds.places.find((x) => x.id === current.placeId)?.name}{current.description ? `. ${current.description}` : ''}</p>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>{current.confidence}{current.sourceIds.length ? ', sourced' : ', no source yet'}{stop >= journey.length - 1 ? '. End of what the record shows.' : ''}</p>
          </div>
        )}
      </div>
    </main>
  );
}
