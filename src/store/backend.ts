import type { Dataset } from '../model/types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Backend abstraction. Local mode keeps everything in this browser.
// Cloud mode talks to Supabase. The cloud adapter is written against the schema in
// supabase/schema.sql but is UNVERIFIED until the Supabase project exists
// (see docs/STATUS.md). Row-level security on the server is the real gate; this
// client code only decides what to ask for.

export interface Backend {
  mode: 'local' | 'cloud';
  load(): Promise<Dataset | null>;
  save(ds: Dataset): Promise<void>;
  signInWithEmail?(email: string): Promise<{ ok: boolean; message: string }>;
  signOut?(): Promise<void>;
  currentUserEmail?(): Promise<string | null>;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function getBackend(): Backend {
  if (url && key) return cloudBackend(createClient(url, key));
  return { mode: 'local', load: async () => null, save: async () => {} };
}

// Cloud mode stores the whole dataset as one JSON document per family in `family_documents`
// for the first release (simple, auditable, easy to back up), while the relational tables
// in schema.sql hold the same data for queries and row-level scoping. Keeping both in step is
// the job of the `sync_document` SQL function. Until the project exists this is a design, not a fact.
function cloudBackend(client: SupabaseClient): Backend {
  return {
    mode: 'cloud',
    async load() {
      const { data, error } = await client.from('family_documents').select('document').eq('id', 'main').maybeSingle();
      if (error || !data) return null;
      return data.document as Dataset;
    },
    async save(ds) {
      await client.from('family_documents').upsert({ id: 'main', document: ds, updated_at: new Date().toISOString() });
    },
    async signInWithEmail(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } });
      return error ? { ok: false, message: error.message } : { ok: true, message: 'Check your email for the sign-in link.' };
    },
    async signOut() {
      await client.auth.signOut();
    },
    async currentUserEmail() {
      const { data } = await client.auth.getUser();
      return data.user?.email ?? null;
    },
  };
}
