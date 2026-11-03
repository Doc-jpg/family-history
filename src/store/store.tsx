import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dataset } from '../model/types';
import { seedDataset } from '../model/seed';
import { mergeServerChanges } from '../model/merge';
import { getBackend, type Backend } from './backend';

// The store holds one Dataset in memory and persists it through a Backend.
// Local mode (default, no Supabase configured): browser storage on this device only.
// Cloud mode: the signed-in admin's copy of the family document, saved to Supabase after
// each change (merged with anything relatives did meanwhile) and refreshed every half minute
// and whenever the window regains focus.

const KEY = 'family-history:dataset:v1';

export type AuthState = { status: 'none' } | { status: 'signed-out' } | { status: 'signed-in'; email: string; admin: boolean };

interface StoreValue {
  ds: Dataset;
  update: (fn: (ds: Dataset) => Dataset) => void;
  replace: (ds: Dataset) => void;
  reset: () => void;
  backend: Backend;
  mode: 'local' | 'cloud';
  ready: boolean;
  auth: AuthState;
  saveError: string | null;
  refresh: () => Promise<void>;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [ds, setDs] = useState<Dataset>(() => (backend.mode === 'local' ? loadLocal() ?? seedDataset() : seedDataset()));
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ status: 'none' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveTick, setSaveTick] = useState(0);
  const seenAt = useRef<string | null>(null); // updated_at of the server copy our in-memory copy is based on
  const dirty = useRef(false);
  const saving = useRef(false);
  const latest = useRef(ds);
  latest.current = ds;

  const loadCloud = useCallback(async () => {
    if (backend.mode !== 'cloud') return;
    const email = (await backend.currentUserEmail?.()) ?? null;
    if (!email) { setAuth({ status: 'signed-out' }); setDs(seedDataset()); seenAt.current = null; return; }
    const got = await backend.load();
    if (got) {
      setDs((cur) => (dirty.current ? mergeServerChanges(cur, got.ds) : got.ds));
      seenAt.current = got.updatedAt;
      setAuth({ status: 'signed-in', email, admin: true });
    } else {
      // Signed in but RLS returned nothing: either not an admin, or no document saved yet.
      setAuth({ status: 'signed-in', email, admin: false });
      seenAt.current = null;
    }
  }, [backend]);

  useEffect(() => {
    (async () => {
      if (backend.mode === 'cloud') {
        await loadCloud();
      } else if (!loadLocal()) {
        // First run on this device: pick up the private dataset if this is the admin's computer.
        const d = await loadPrivateDataset();
        if (d) setDs(d);
      }
      setReady(true);
    })();
    if (backend.mode !== 'cloud') return;
    const off = backend.onAuthChange?.(() => { void loadCloud(); });
    const tick = setInterval(() => { if (!dirty.current) void loadCloud(); }, 30000);
    const onFocus = () => { if (!dirty.current) void loadCloud(); };
    window.addEventListener('focus', onFocus);
    return () => { off?.(); clearInterval(tick); window.removeEventListener('focus', onFocus); };
  }, [backend, loadCloud]);

  // Persist after each change. Local: synchronously to localStorage. Cloud: debounced merge-save.
  useEffect(() => {
    if (!ready) return;
    if (backend.mode === 'local') {
      try { localStorage.setItem(KEY, JSON.stringify(ds)); } catch { /* storage may be unavailable */ }
      return;
    }
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      if (saving.current) return; // the running save will reschedule when it finishes
      saving.current = true;
      const snapshot = latest.current;
      try {
        const r = await backend.save(snapshot, seenAt.current);
        seenAt.current = r.updatedAt;
        if (latest.current === snapshot) {
          dirty.current = false;
          if (r.ds !== snapshot) setDs(r.ds); // merged-in relative activity
        } else {
          // Edited again while saving: fold in whatever the server had and save once more.
          if (r.ds !== snapshot) setDs((cur) => mergeServerChanges(cur, r.ds));
          setSaveTick((x) => x + 1);
        }
        setSaveError(null);
      } catch (e) {
        setSaveError((e as Error).message);
        setTimeout(() => setSaveTick((x) => x + 1), 5000); // try again shortly
      } finally {
        saving.current = false;
      }
    }, 800);
    return () => clearTimeout(t);
  }, [ds, ready, backend, saveTick]);

  const update = useCallback((fn: (d: Dataset) => Dataset) => { dirty.current = true; setDs((d) => fn(d)); }, []);
  const replace = useCallback((d: Dataset) => { dirty.current = true; setDs(d); }, []);
  const reset = useCallback(() => { dirty.current = true; setDs(seedDataset()); }, []);
  const refresh = useCallback(async () => { await loadCloud(); }, [loadCloud]);

  return <Ctx.Provider value={{ ds, update, replace, reset, backend, mode: backend.mode, ready, auth, saveError, refresh }}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}
