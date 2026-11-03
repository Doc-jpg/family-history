import type { Attestation, Dataset, Person, Standing } from './types';
import { newId } from './graph';

// The self-governance rules, as pure functions. See docs/GOVERNANCE.md for the plain-English version.

export const PEN_THRESHOLD = 2; // distinct people confirming
export const OVERWHELM_MARGIN = 2; // confirmations minus open disputes needed to override a dispute

export interface StandingDetail {
  standing: Standing;
  confirms: Attestation[]; // latest stance per person, confirm
  disputes: Attestation[]; // latest stance per person, open dispute
  documented: boolean;
  summary: string;
}

/** Does the record for this person rest on a documentary source (not just what a relative said)? */
export function isDocumented(ds: Dataset, personId: string): boolean {
  const events = ds.events.filter((e) => e.personIds.includes(personId));
  const sourceIds = new Set(events.flatMap((e) => e.sourceIds));
  for (const r of ds.relationships) if ((r.fromId === personId || r.toId === personId) && r.status === 'verified') r.sourceIds.forEach((id) => sourceIds.add(id));
  return [...sourceIds].some((id) => {
    const s = ds.sources.find((x) => x.id === id);
    return !!s && (s.confidence === 'verified' || s.confidence === 'likely') && !/^told by|^statement|^text message|^recollection/i.test(s.repository ?? '') && !/^Statement by/i.test(s.title);
  });
}

/** Latest stance per attester for a person (optionally one field), ignoring resolved disputes. */
export function latestStances(ds: Dataset, personId: string, field?: string): Attestation[] {
  const all = (ds.attestations ?? []).filter((a) => a.personId === personId && (field ? a.field === field || !a.field : true) && !a.resolvedAt);
  const byPerson = new Map<string, Attestation>();
  for (const a of [...all].sort((x, y) => x.at.localeCompare(y.at))) byPerson.set(a.by, a);
  return [...byPerson.values()];
}

export function standingOf(ds: Dataset, personId: string): StandingDetail {
  const documented = isDocumented(ds, personId);
  const latest = latestStances(ds, personId);
  const confirms = latest.filter((a) => a.stance === 'confirm');
  const disputes = latest.filter((a) => a.stance === 'dispute');
  const names = (xs: Attestation[]) => xs.map((a) => a.byName).join(', ');
  let standing: Standing;
  if (disputes.length && confirms.length - disputes.length < OVERWHELM_MARGIN && !documented) standing = 'disputed';
  else if (documented) standing = 'documented';
  else if (confirms.length >= PEN_THRESHOLD) standing = 'pen';
  else if (confirms.length === 1) standing = 'pencil';
  else standing = 'unattested';
  const summary =
    standing === 'disputed' ? `In pencil: ${names(disputes)} ${disputes.length === 1 ? 'thinks' : 'think'} something here is wrong${confirms.length ? `; ${names(confirms)} ${confirms.length === 1 ? 'has' : 'have'} confirmed it` : ''}.`
    : standing === 'documented' ? `Backed by a record${confirms.length ? `; also confirmed by ${names(confirms)}` : ''}${disputes.length ? `. ${names(disputes)} raised a question, flagged for research` : ''}.`
    : standing === 'pen' ? `In pen: confirmed by ${names(confirms)}.`
    : standing === 'pencil' ? `In pencil: told by ${names(confirms)} and not yet confirmed by anyone else.`
    : 'Not yet confirmed by any relative.';
  return { standing, confirms, disputes, documented, summary };
}

/** Record a stance. One stance per attester per person+field: a new one replaces the old. */
export function attest(ds: Dataset, input: { personId: string; by: string; byName: string; stance: Attestation['stance']; field?: string; note?: string }): Dataset {
  const now = new Date().toISOString();
  const kept = (ds.attestations ?? []).filter((a) => !(a.personId === input.personId && a.by === input.by && (a.field ?? 'general') === (input.field ?? 'general') && !a.resolvedAt));
  const a: Attestation = { id: newId('att'), personId: input.personId, field: input.field, by: input.by, byName: input.byName, stance: input.stance, note: input.note, at: now };
  return { ...ds, attestations: [...kept, a] };
}

/** The admin settles an open dispute (after research or a correction). */
export function resolveDispute(ds: Dataset, attestationId: string, resolution: string): Dataset {
  const now = new Date().toISOString();
  return { ...ds, attestations: (ds.attestations ?? []).map((a) => (a.id === attestationId ? { ...a, resolvedAt: now, resolution } : a)) };
}

/** People a relative should be asked about: in pencil or disputed, and not yet attested by them. */
export function needsConfirmation(ds: Dataset, people: Person[], by: string): { person: Person; detail: StandingDetail }[] {
  return people
    .filter((p) => !p.placeholder)
    .map((p) => ({ person: p, detail: standingOf(ds, p.id) }))
    .filter(({ person, detail }) => (detail.standing === 'pencil' || detail.standing === 'disputed') && !latestStances(ds, person.id).some((a) => a.by === by));
}
