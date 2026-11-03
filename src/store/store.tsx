import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Dataset } from '../model/types';
import { seedDataset } from '../model/seed';
import { getBackend, type Backend } from './backend';

// The store holds one Dataset in memory and persists it through a Backend.
// Local mode (default, no Supabase configured): browser storage on this device only.
// Cloud mode: Supabase, with row-level security doing the real enforcement.

const KEY = 'family-history:dataset:v1';

interface StoreValue {
  ds: Dataset;
  update: (fn: (ds: Dataset) => Dataset) => void;
  replace: (ds: Dataset) => void;
  reset: () => void;
  backend: Backend;
  mode: 'local' | 'cloud';
  ready: boolean;
}

const Ctx = createContext<StoreValue | null>(null);

export function loadLocal(): Dataset | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Dataset;
      if (parsed.schemaVersion === 1) return { ...parsed, accessRequests: parsed.accessRequests ?? [] };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** On the admin's own computer, server.cjs serves the git-ignored private dataset; elsewhere this 404s and is ignored. */
async function loadPrivateDataset(): Promise<Dataset | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}private/family-dataset.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = (await r.json()) as Dataset;
    return d.schemaVersion === 1 && Array.isArray(d.people) ? { ...d, accessRequests: d.accessRequests ?? [] } : null;
  } catch {
    return null;
  }
}

/**
 * When the shipped seed gains facts (a slot filled in from the owner's own words), bring them into
 * a browser that already holds an older copy, without touching anything the admin changed:
 * people still marked placeholder are replaced; new events, places, sources, relationships and
 * questions are added by id; existing ones are left alone.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [ds, setDs] = useState<Dataset>(() => (backend.mode === 'local' ? loadLocal() ?? seedDataset() : seedDataset()));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      if (backend.mode === 'cloud') {
        const d = await backend.load();
        if (d) setDs(d);
      } else if (!loadLocal()) {
        // First run on this device: pick up the private dataset if this is the admin's computer.
        const d = await loadPrivateDataset();
        if (d) setDs(d);
      }
      setReady(true);
    })();
  }, [backend]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(ds));
    } catch {
      /* storage may be unavailable; the in-memory copy still works */
    }
    if (backend.mode === 'cloud') void backend.save(ds);
  }, [ds, ready, backend]);

  const update = useCallback((fn: (d: Dataset) => Dataset) => setDs((d) => fn(d)), []);
  const replace = useCallback((d: Dataset) => setDs(d), []);
  const reset = useCallback(() => setDs(seedDataset()), []);

  return <Ctx.Provider value={{ ds, update, replace, reset, backend, mode: backend.mode, ready }}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}
