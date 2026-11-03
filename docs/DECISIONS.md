# Decisions

| # | Date | Decision | Why | Status |
|---|---|---|---|---|
| 1 | 2026-11-02 | Static app on GitHub Pages + Supabase, not Next.js on Vercel | Fewer vendors; same pattern as Dugout Dad / Dugout Lab / Athletic Lab; Supabase already covers auth, RLS, storage, functions. Can move to Vercel later without rewriting. | adopted |
| 2 | 2026-11-02 | One JSON document as the record, relational projection for scoped reads | Trivial backup/restore/versioning; the app is built around one Dataset; server policies still enforce scope on the projection. Revisit if the family grows past a few thousand people. | adopted |
| 3 | 2026-11-02 | Invitation = link token + separate code (+ email verification in cloud mode); only hashes stored | The prompt forbids relying on the URL alone. Two channels, nothing secret in the database. | adopted |
| 4 | 2026-11-02 | Placeholder slots instead of invented ancestors | The tree needs shape before facts exist; slots are visibly empty, never exported, never shown to relatives. | adopted |
| 5 | 2026-11-02 | Children recorded by first name only, no dates | Family & Home rule: kids' details stay at first names and activities. Deren can add dates later. | adopted |
| 6 | 2026-11-02 | Public repo, private data | GitHub Pages on a personal account needs a public repo; all family data lives in the database and git-ignored folders. Same as the other three apps. | adopted |
| 7 | 2026-11-02 | Historical context list is general and labeled as such | The timeline wants context; it must never read as a family fact. | adopted |
| 8 | 2026-11-02 | One link, one contributor device; forwarded links open view-only by default; others request their own access | Deren: a recipient must not be able to text the link to siblings who then edit as her. View-only is acceptable for anyone; contributing is personal and gated. | adopted |
| 9 | 2026-11-02 | "Device" = browser profile, with an admin Release button | Honest limit of web apps without an install; Release covers new phones and cleared browsers without reissuing the link. | adopted |
