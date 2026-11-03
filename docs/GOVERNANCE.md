# Pencil and pen: how the archive governs itself

The family historian (the admin) cannot personally verify everything relatives send in, and the archive is meant to spread to cousins, in-laws and other branches. So the record carries its own rules for what is settled and what is still a guess. The app enforces them; this page is the plain-English version. The code is `src/model/standing.ts`.

## Every person's record has a standing

| Standing | Meaning | How it looks |
|---|---|---|
| **Documented** | A record backs it: a certificate, census page, obituary, headstone, newspaper. Attached as a source by the admin. | Solid. "Backed by a record." |
| **Pen** | Two or more different relatives have said it looks right. | Solid. "In pen: confirmed by A and B." |
| **Pencil** | One relative told us, nobody else has checked. | Dashed. "In pencil: told by A." Named, never anonymous. |
| **Under question** | Someone has said something is wrong, and confirmations do not outnumber open questions by two. | Dashed, red. The admin sees it in the inbox. |
| **Unconfirmed** | Entered by the admin from research notes; no relative has weighed in. | Plain. |

Standing is computed from the attestations every time it is shown. It is never stored, so the rules can change later without touching the data.

## How a fact moves

1. **Nomination.** A relative submits a memory, a correction, a missing person. The admin reviews it (approve, research further, ask for clarification, partially accept, reject, mark disputed). Accepting it writes it into the record **in pencil**, with the relative's confirmation counted as the first voice.
2. **Second voice.** The app asks relatives one to three steps from that person ("Does this look right?", in their Fill-in-the-blanks list). A second, different relative tapping **Looks right** turns pencil into **pen**.
3. **Objection.** Anyone with a contributor link can tap **Something's off** on any person, say which part (name, birth, death, parents, spouse, children, or "wrong person entirely") and what they know instead. That records a dispute, drops the standing to **under question**, and lands in the admin's inbox as a `dispute` contribution.
4. **Tug of war.** More confirmations can override an objection: the record returns to pen once confirmations outnumber open objections by two. Otherwise it stays under question until the admin settles it (after research, or after applying a correction), which closes the objection but keeps it in the history.
5. **Documents outrank votes.** A documented record stays documented; an objection against it becomes a research flag for the admin instead of a reversal. If the research shows the document was misread, the admin corrects the record and the flag is settled.

## Who counts

- One voice per relative per person. Each invitation is one relative; the same person tapping twice still counts once, and a new stance replaces the old one (people may change their minds).
- The relative who originally told us counts as the first voice.
- The admin's own recollections count as one voice, like anyone's ("told by Deren" is pencil until a second relative confirms). The admin's other role, reviewing, attaching documents, applying corrections and settling objections, is not a vote. Research is a separate track that runs alongside the family's votes.
- View-only links cannot confirm or object. Anyone can request their own contributor link.
- Distance is shown ("your mother", "your second cousin") but not weighted. A closer relative's word is not automatically worth more; that judgement stays with the admin when settling questions.

## What relatives are asked

The Fill-in-the-blanks list is built from where the relative stands in the tree:
- their own line (parents, grandparents, great-grandparents) where facts are missing;
- the people one or two steps out (brothers and sisters, children, nieces and nephews) who often have only a first name, a missing birth date, a missing spouse or children;
- pencil and under-question records within three steps that they have not yet weighed in on.

Facts that are recorded but withheld from that relative's view (living people's birth details, for instance) are not asked for again.

## What never changes by vote

- Placeholder slots and anyone marked private are never shown to relatives, whatever the votes.
- Nothing a relative does edits the record directly. Every change passes through the admin's inbox and is logged with rollback.
- Children of the admin's household stay at first names unless the admin records more.
