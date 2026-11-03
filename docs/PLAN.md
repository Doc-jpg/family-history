# Execution plan

## Phase 1: Discovery and initial research (started 2026-11-02)
- [x] Seed with Deren (name, DOB, birthplace: sourced to his own statement).
- [x] Placeholder slots for parents and four grandparents; research backlog seeded with the seven questions that unblock everything.
- [ ] Deren supplies the minimum facts (see the private STATUS notes).
- [ ] First research pass on public records once names and places exist (FamilySearch, Find a Grave, newspaper archives, state archives). Every claim logged in the private research log (`data/private/docs/RESEARCH_LOG.md`, git-ignored) with source, link, date accessed, confidence, conflicts.

## Phase 2: Architecture and design (done 2026-11-02)
- [x] Stack, data model, privacy model, hosting: ARCHITECTURE.md, PRIVACY.md, supabase/schema.sql.
- [x] Design system: parchment/ink/linen themes, Fraunces + Source Sans, branch colors customizable.

## Phase 3: Functional first release
- [x] Starting profile, structured database, interactive tree, map, timeline, profiles.
- [x] Recipient-specific invitations (link + code), contributor forms, review inbox, audit and rollback, export/backup.
- [x] Browser-tested (32 checks, phone and laptop).
- [ ] Deployed: needs the GitHub repo `Doc-jpg/family-history` (Deren creates, allows the Claude GitHub app) then push. Address will be https://doc-jpg.github.io/family-history/.
- [ ] Admin sign-in and server-enforced permissions: needs the Supabase project (free tier, organization already exists), schema applied, edge function deployed, two repository variables set. Then cloud mode replaces local mode.

## Phase 4: Research and family expansion
- Fill the slots from Deren's facts, then widen: siblings, aunts and uncles, great-grandparents.
- Each ancestor gets birth/death/marriage/residence events with sources; places get coordinates so the map fills in.
- Research assistant: suggested next records per person based on what is missing.

## Phase 5: Collaborative participation
- Invite a first relative on each side (viewer or contributor), walk the invitation on a real phone, confirm the submission appears under their identity, test revoke and expiry on the live system.
- Photo identification and uploads (Storage bucket is in the schema).

## Phase 6: Refinement and long-term operation
- Preview-as-relative screen; family stories generated from documented facts (evidence and interpretation separated); then-and-now geography; generational comparison; printable family book and profile PDFs.
- Backups: scheduled JSON export to Deren's Drive; `document_versions` on the server; GEDCOM each quarter.

## Growing from every twig (Deren, 2026-11-02 22:10)
The tree should grow outward from any relative, not only from Deren. Built: relatives can attach photos, documents, audio and video to a contribution and record a voice memo in the browser; each invited relative can center the tree on themselves; an "Add my own family (my branch)" form collects spouse, parents, children, siblings and grandparents in one submission. Next on this path:
1. Cloud mode, so files and submissions travel between devices (local mode keeps them on the device they were added on).
2. Branch stewards: a trusted editor per branch who can approve submissions inside their own branch, with Deren still able to see and reverse everything.
3. "Start my own tree" export: a relative downloads a GEDCOM of their branch to seed their own tree elsewhere.
4. Scale: the single JSON document is fine to a few thousand people; past that the relational tables in the schema become the primary store and the app reads by branch.

## Later enhancements (not blocking)
GEDCOM import; direct edits for trusted editors with configurable review policies; audio oral histories; contribution recognition; custom domain.
