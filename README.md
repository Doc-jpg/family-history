# Family History

A private, collaborative family-history platform: an interactive tree, a map of where the family lived and moved, a timeline, a profile for every person, and personal invitations that let relatives add memories, documents, recordings and corrections into a review inbox without ever overwriting the approved record.

**No family data lives in this repository.** The code is public; the archive is not. The real dataset is held in the owner's Supabase project (cloud mode) or in the git-ignored `data/private/` folder on the owner's own computer (local mode). The shipped seed is an empty archive with one root person and two unnamed parent slots. **Nothing is ever guessed or invented.**

## Run it
- Live address: `https://doc-jpg.github.io/family-history/` (GitHub Pages, deployed by Actions on every push to `main`).
- On the owner's computer: `START_FAMILY_HISTORY.cmd` then open http://localhost:4178/family-history/ (needs `npm run build` first). `server.cjs` also serves `data/private/family-dataset.json`, which the app loads on first run in local mode.
- Development: `npm install`, `npm run dev`.
- Tests: `npm test` (model, runs anywhere) and `npm run build && npm run accept` (browser walk; needs the private dataset, writes screenshots to `test-results/`).

## Modes
- **Local mode** (no Supabase configured): everything is saved in one browser. A single-browser draft for the owner.
- **Cloud mode** (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` set as repository variables): sign-in, server-enforced permissions through row-level security, one shared database, versioned snapshots, private media storage. See `docs/ARCHITECTURE.md` and `supabase/`.

## Layout
- `src/model/` the data model (`types.ts`), the empty public seed, graph utilities (relationship finder), access scoping, review workflow, GEDCOM export. Pure functions, all unit-tested.
- `src/store/` persistence: local (browser) or cloud (Supabase) behind one interface; media in IndexedDB or Supabase Storage.
- `src/views/` Home, Tree (D3), Map (Leaflet), Timeline, Person, Relation explorer, Admin, Invite (the relative's experience).
- `supabase/schema.sql` the Postgres schema with row-level security; `supabase/functions/redeem-invite/` the edge function that binds an invitation to one verified email and one device.
- `docs/` ARCHITECTURE, PRIVACY, PLAN, DECISIONS.
- `data/private/` (git-ignored): the real dataset, seed sources, research log, journal, status notes and backups. Never committed.

## Principles
1. Evidence first: every fact carries a source and a confidence (verified, likely, tentative, unresearched).
2. Private by default: the data is never public; relatives see only the branch they were granted; living people's details are withheld unless allowed.
3. Relatives propose, the admin decides: submissions go to an inbox with six outcomes and a full audit trail with rollback.
4. One link, one contributor device: an invitation link works for contributing on the first device that enters its code; forwarded copies open view-only, and anyone else can request their own access.
5. Ownership and portability: plain JSON backup, GEDCOM export, code and hosting in the owner's own accounts.
