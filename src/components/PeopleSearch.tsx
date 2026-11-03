import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/store';
import { displayName } from '../model/graph';
import { SearchIcon } from './Icons';
import { Avatar, lifespan } from './PersonBits';

// Find a person from anywhere. Matches given names, surnames, maiden names and nicknames.
export default function PeopleSearch() {
  const { ds } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const needle = q.trim().toLowerCase();
  const hits = needle.length < 2 ? [] : ds.people.filter((p) => !p.placeholder && [p.givenNames, p.surname, p.maidenName ?? '', ...(p.altNames ?? [])].join(' ').toLowerCase().includes(needle)).slice(0, 8);
  return (
    <div className="search" ref={box} role="search">
      <SearchIcon />
      <input aria-label="Find a person" placeholder="Find a person" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); } }} />
      {open && needle.length >= 2 && (
        <div className="results" role="listbox">
          {hits.length === 0 && <div className="empty">No one by that name yet.</div>}
          {hits.map((p) => (
            <Link key={p.id} to={`/person/${p.id}`} role="option" onClick={() => { setOpen(false); setQ(''); }}>
              <Avatar p={p} size="sm" />
              <span><strong>{displayName(p)}</strong><br /><small className="muted">{lifespan(ds, p) || p.branch}</small></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
