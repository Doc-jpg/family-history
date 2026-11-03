// Public connection details for cloud mode. The Supabase URL and the *publishable* key are
// meant to ship in the browser bundle (they identify the project; row-level security and the
// edge function do the gatekeeping). The service key never appears anywhere in this repo.
// Repository variables VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY override these at build time.
// Leave both empty to run in local mode.
export const PUBLIC_SUPABASE = {
  url: '',
  publishableKey: '',
};
