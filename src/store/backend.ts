import type { Dataset, Media } from '../model/types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mergeServerChanges } from '../model/merge';
import { cloudInviteApi, localInviteApi, type InviteApi } from '../model/invite-api';
import { getFile, putFile } from './media';
import { PUBLIC_SUPABASE } from '../config';

// Backend abstraction. Local mode keeps everything in this browser.
// Cloud mode talks to Supabase:
//   - the admin signs in with an emailed link; row-level security lets admins (rows in the
//     `admins` table) read and write the one family document;
//   - relatives never touch the database: their browser calls the `invite` edge function,
//     which applies the invitation rules with the service key and returns only the redacted
//     dataset for their scope.

export interface Backend {
  mode: 'local' | 'cloud';
  /** The admin's full document, or null when not signed in / not an admin / nothing saved yet. */
  load(): Promise<{ ds: Dataset; updatedAt: string } | null>;
  /** Save the admin's copy, merged with anything relatives did since `seenAt`. Returns the merged document that is now on the server. */
  save(ds: Dataset, seenAt: string | null): Promise<{ ds: Dataset; updatedAt: string }>;
  invite: (get: () => Dataset, update: (fn: (d: Dataset) => Dataset) => void) => InviteApi;
  /** A URL for a media record, for the admin's eyes. */
  mediaUrl(m: Media): Promise<string | null>;
  signInWithEmail?(email: string): Promise<{ ok: boolean; message: string }>;
  signOut?(): Promise<void>;
  currentUserEmail?(): Promise<string | null>;
  onAuthChange?(cb: () => void): () => void;
}

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || PUBLIC_SUPABASE.url;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || PUBLIC_SUPABASE.publishableKey;

/** On localhost (the owner's computer, the acceptance walk) stay in local mode unless asked; anywhere else, cloud when configured. */
function wantsCloud(): boolean {
  if (!url || !key) return false;
  try {
    const h = window.location.hostname;
    const local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    if (!local) return true;
    return localStorage.getItem('family-history:mode') === 'cloud';
  } catch {
    return true;
  }
}

export function getBackend(): Backend {
  if (wantsCloud()) return cloudBackend(createClient(url!, key!));
  return localBackend();
}

function localBackend(): Backend {
  return {
    mode: 'local',
    load: async () => null,
    save: async (ds) => ({ ds, updatedAt: new Date().toISOString() }),
    invite: (get, update) => localInviteApi(get, update, putFile, getFile),
    async mediaUrl(m) {
      if (m.dataUrl) return m.dataUrl;
      if (m.storagePath?.startsWith('local:')) { const b = await getFile(m.storagePath.slice(6)); return b ? URL.createObjectURL(b) : null; }
      return null;
    },
  };
}

const BUCKET = 'family-media';

function cloudBackend(client: SupabaseClient): Backend {
  async function read() {
    const { data, error } = await client.from('family_documents').select('document, updated_at').eq('id', 'main').maybeSingle();
    if (error || !data) return null;
    const d = data.document as Dataset;
    return { ds: { ...d, accessRequests: d.accessRequests ?? [] }, updatedAt: data.updated_at as string };
  }
  async function callInvite(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await client.functions.invoke('invite', { body });
    if (error) {
      // The function returns JSON bodies with non-2xx statuses for refusals; surface them as results.
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') { try { return (await ctx.json()) as Record<string, unknown>; } catch { /* fall through */ } }
      return { ok: false, reason: error.message };
    }
    return data as Record<string, unknown>;
  }
  return {
    mode: 'cloud',
    load: read,
    async save(ds, seenAt) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const cur = await read();
        if (!cur) {
          const now = new Date().toISOString();
          const { error } = await client.from('family_documents').insert({ id: 'main', document: ds, updated_at: now });
          if (!error) return { ds, updatedAt: now };
          continue;
        }
        const merged = cur.updatedAt === seenAt ? ds : mergeServerChanges(ds, cur.ds);
        const now = new Date().toISOString();
        const { data } = await client.from('family_documents').update({ document: merged, updated_at: now }).eq('id', 'main').eq('updated_at', cur.updatedAt).select('id');
        if (data && data.length) return { ds: merged, updatedAt: now };
      }
      throw new Error('Could not save: the document kept changing underneath. Try again.');
    },
    invite: () => cloudInviteApi(callInvite, async (path, signedToken, file) => {
      const { error } = await client.storage.from(BUCKET).uploadToSignedUrl(path, signedToken, file, { upsert: false });
      if (error) throw new Error(error.message);
    }),
    async mediaUrl(m) {
      if (m.dataUrl) return m.dataUrl;
      if (!m.storagePath || m.storagePath.startsWith('local:')) return null;
      const { data } = await client.storage.from(BUCKET).createSignedUrl(m.storagePath, 60 * 60);
      return data?.signedUrl ?? null;
    },
    async signInWithEmail(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL } });
      return error ? { ok: false, message: error.message } : { ok: true, message: 'Check your email for the sign-in link. Open it on this device.' };
    },
    async signOut() {
      await client.auth.signOut();
    },
    async currentUserEmail() {
      const { data } = await client.auth.getSession();
      return data.session?.user.email ?? null;
    },
    onAuthChange(cb) {
      const { data } = client.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
  };
}
