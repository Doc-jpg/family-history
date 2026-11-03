# Architecture

## Stack (recommended and implemented)
| Layer | Choice | Why |
|---|---|---|
| App | Vite + React 18 + TypeScript, single-page, hash routing | Same shape as Dugout Dad, Dugout Lab and Athletic Lab, so it deploys to GitHub Pages with no server to run, and the code is already familiar in this family's setup. |
| Tree | D3 (hierarchy + tree layout + zoom), hourglass chart: ancestors above, descendants below | Expand, collapse, zoom, branch colors, verified/unverified line styles, path highlighting. |
| Map | Leaflet + OpenStreetMap tiles | Free, no key, works on phones. Markers per placed event, polylines per person's movement, year slider. |
| Timeline | Hand-built SVG | Lifespans by generation, a year scrubber ("the family in 1950"), general historical context clearly labeled. |
| Data | One `Dataset` document (people, relationships, events, places, sources, media, questions, invitations, contributions, audit, settings), stable ids everywhere | Simple to back up, restore, diff and export. |
| Persistence | **Local mode:** browser storage. **Cloud mode:** Supabase (Postgres + Auth + Storage + Edge Functions) | Local mode works today with zero accounts. Cloud mode gives sign-in, server-enforced permissions and a shared database. |
| Hosting | GitHub Pages from `Doc-jpg/family-history` via Actions | Free, Deren's account, redeploys on every push. The page shell is public; the data is not. |
| Code | GitHub, Deren's personal account (Doc-jpg) | Ownership. No family data in the repo (`data/private/` is git-ignored). |

### Why not Next.js on Vercel
It would work, and it is the right answer if we ever need server-rendered pages or a custom domain with middleware. It adds a third vendor and a server runtime to maintain. Supabase already gives us the server-side pieces this project needs (auth, row-level security, storage policies, one edge function), and GitHub Pages hosts the rest. If we outgrow it, the app is a standard Vite build and moves to Vercel or Netlify in an afternoon.

## Modes
- **Local mode** (now): the dataset lives in the browser. Invitations and contributions work for testing on one machine. Two tabs on the same browser can overwrite each other (last writer wins); not a problem once cloud mode is on.
- **Cloud mode** (after the Supabase project exists and `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are set as repository variables): the admin signs in by email link; the dataset is saved to `family_documents` and every save is versioned; `publish_scoped_view()` rebuilds the scoped tables relatives read; invitations are redeemed by the `redeem-invite` edge function after the relative verifies their email with a one-time code.

## Security model (summary; detail in PRIVACY.md)
- Admin = the one auth user in `admins`. Everything else is denied by default through row-level security.
- Invitation = unguessable link token + separate 6-digit code + email verification. Only sha256 hashes are stored. Revocable, expiring, resendable.
- Relatives can only `INSERT` into `contributions`; a trigger stamps their identity server-side so it cannot be forged. They never write to the record.
- Living people: names and relationships are visible within scope; birth details and residences are withheld unless the invitation allows them.
- Placeholders (empty slots) and anyone marked `private` are never visible to relatives.

## Data flow for a contribution
1. Relative opens link, enters code (and in cloud mode, verifies email).
2. Picks a person, picks a contribution kind, writes it, says how they know.
3. Submission is inserted with `status: new`, stamped with invitation identity and time.
4. Admin inbox shows it; admin picks Approve / Research further / Request clarification / Partially accept / Reject-archive / Mark disputed.
5. Approve or Partially accept with structured fields applies the change to the person and writes an audit entry with the previous version; Roll back is one click on the Audit tab.

## Exports
- JSON backup (everything), restore from JSON.
- GEDCOM 5.5.1 (individuals, families, events, places, sources); placeholders skipped; private people optional.
- In cloud mode: `document_versions` keeps every prior version; Storage bucket `family-media` keeps originals.
