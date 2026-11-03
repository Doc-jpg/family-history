# Privacy and security model

## Defaults
- The archive is private. The web page shell is public (it is a static site) but shows nothing without sign-in (cloud mode) or without a valid invitation link plus code.
- `noindex, nofollow` on the page. No analytics. No third-party scripts beyond fonts and map tiles.
- Deren is the only administrator. Admin rights are a database row, not a UI setting.

## What a relative can see
Each invitation carries a scope: which branches (paternal, maternal, household), any specific extra people, and whether living people's birth details may be shown. The rules, enforced in `src/model/access.ts` for the UI and in `supabase/schema.sql` (`person_visible`, policies) for the server:
- Deren is always visible (he is the root).
- Empty slots (placeholders) are never shown.
- People marked `private` are never shown.
- Living people: name, relationships, death-free facts. Birth date/place, residences and census rows are withheld unless `includeLivingDetails` is on for that invitation.
- Admin notes, open questions, invitations, other people's contributions and the audit log are never sent to a relative.
- Media marked private is never shown; other media only when it is attached to someone in scope.

## Invitations
- Link token: 24 random bytes, base64url, only ever in the link. Stored as sha256.
- One-time code: 6 digits, shown to the admin once, given to the relative by a different channel (text, phone). Stored as sha256.
- Cloud mode adds email verification (Supabase Auth one-time code to the invitee's email) before the invitation binds to that user. A forwarded link does not work without the code and the email.
- Expiry (default 30 days), revoke, reinstate, and a status view (pending, active, revoked, expired, last seen, verified email).

## One link, one contributor device (Deren, 2026-11-02)
- The first device that enters the code becomes the only device that can contribute on that link. The database stores a hash of that device's id (a random id kept in that browser), the date, and a label like "iPhone Safari".
- If the link is forwarded, the other device gets whatever the invitation's `forwarded` setting says: **view-only with no code** (default, so the link is safe to pass around), view-only after the code, or nothing at all. A view-only visitor can never submit; every screen offers "Request access to contribute".
- A request collects name, relationship, email or phone, and a note; it shows on the admin Requests tab. Granting it mints that person their own link and code, scoped like the link they came in on, so they contribute under their own name, never as the original recipient.
- "Device" means a browser profile. A new phone or a cleared browser means Deren presses Release on that invitation and the next device to enter the code takes over. Revoke still kills the link everywhere.
- Cloud mode adds email verification on top, so a full session needs the link, the code, the bound device and the verified email.

## What a relative can do
- Viewer: explore within scope.
- Contributor: explore and submit. Submissions are inserts only; the server stamps who submitted and when.
- Trusted editor: same as contributor today; the inbox marks their submissions for fast review. Direct edits by editors are a later feature, gated by review policies the admin configures.
- Nobody but the admin changes the approved record.

## Living people and minors
- The children are recorded by first name only, no dates, on purpose. Adding dates for them is the admin's call.
- The spouse is recorded by name only until she chooses otherwise.

## Uploads
- Cloud mode: private Storage bucket `family-media`; relatives can only write to a `contributions/` folder and only read media attached to people in their scope. Originals are kept as uploaded.
- Before uploads are enabled: file type and size limits, and image stripping of location metadata, go into the upload step.

## Deletion and correction
- Any relative can ask for their submission or their own data to be removed; the admin archives or deletes it and the audit log records the action.
- Every change to a person keeps the previous version (audit `before`) and can be rolled back.

## Before anything is shared more widely
Show Deren exactly which people and fields a given invitation exposes (the Invitations tab shows scope; a "preview as this relative" button is on the roadmap so he can see the exact screen they will see).

## Known limits right now
- Local mode has no sign-in; it is a single-browser draft for Deren only.
- The cloud schema and edge function are written but not yet applied or tested against a real project.
- Email delivery for verification uses Supabase's built-in sender, which is rate-limited to a handful of emails per hour; fine for inviting a few relatives at a time. For a bigger rollout, point Supabase at a custom SMTP (Resend has a free tier). That is a Deren sign-up.
