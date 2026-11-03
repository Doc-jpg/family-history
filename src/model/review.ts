import type { AuditEntry, Contribution, ContributionStatus, Dataset, Person } from './types';
import { newId } from './graph';

export const REVIEW_ACTIONS: { status: ContributionStatus; label: string; help: string }[] = [
  { status: 'approved', label: 'Approve', help: 'Accept it into the family record.' },
  { status: 'research', label: 'Research further', help: 'Keep it as a lead to investigate.' },
  { status: 'clarify', label: 'Request clarification', help: 'Ask the contributor for more detail.' },
  { status: 'partial', label: 'Partially accept', help: 'Take only the part the evidence supports.' },
  { status: 'rejected', label: 'Reject / archive', help: 'Keep the submission in history without adding it to the record.' },
  { status: 'disputed', label: 'Mark as disputed', help: 'Keep competing claims side by side until evidence settles it.' },
];

export function audit(ds: Dataset, entry: Omit<AuditEntry, 'id' | 'at'>): Dataset {
  return { ...ds, audit: [{ id: newId('a'), at: new Date().toISOString(), ...entry }, ...ds.audit] };
}

/** Change a contribution's status. Never touches the approved record by itself. */
export function reviewContribution(ds: Dataset, contributionId: string, status: ContributionStatus, by: string, note?: string): Dataset {
  const c = ds.contributions.find((x) => x.id === contributionId);
  if (!c) return ds;
  const updated: Contribution = {
    ...c,
    status,
    reviewNotes: note ?? c.reviewNotes,
    history: [...c.history, { at: new Date().toISOString(), by, action: status, note }],
  };
  const next = { ...ds, contributions: ds.contributions.map((x) => (x.id === contributionId ? updated : x)) };
  return audit(next, { actor: by, action: `review:${status}`, entity: 'contribution', entityId: contributionId, before: c.status, after: status });
}

/**
 * Apply an approved correction to a person. Fields come from the contribution form.
 * Records the previous version in the audit log so it can be rolled back.
 */
export function applyPersonCorrection(ds: Dataset, contribution: Contribution, by: string): Dataset {
  if (contribution.subject.type !== 'person' || !contribution.subject.id || !contribution.fields) return ds;
  const before = ds.people.find((p) => p.id === contribution.subject.id);
  if (!before) return ds;
  const f = contribution.fields;
  const after: Person = {
    ...before,
    givenNames: f.givenNames ?? before.givenNames,
    surname: f.surname ?? before.surname,
    maidenName: f.maidenName ?? before.maidenName,
    bio: f.bio ?? before.bio,
    placeholder: f.givenNames || f.surname ? false : before.placeholder,
    confidence: before.confidence === 'unresearched' ? 'likely' : before.confidence,
    updatedAt: new Date().toISOString(),
  };
  const next = { ...ds, people: ds.people.map((p) => (p.id === after.id ? after : p)) };
  return audit(next, { actor: by, action: 'apply-correction', entity: 'person', entityId: after.id, before, after });
}

/** Roll back a person to the "before" snapshot of an audit entry. */
export function rollbackPerson(ds: Dataset, auditId: string, by: string): Dataset {
  const entry = ds.audit.find((a) => a.id === auditId);
  if (!entry || entry.entity !== 'person' || !entry.before) return ds;
  const before = entry.before as Person;
  const current = ds.people.find((p) => p.id === before.id);
  const next = { ...ds, people: ds.people.map((p) => (p.id === before.id ? { ...before, updatedAt: new Date().toISOString() } : p)) };
  return audit(next, { actor: by, action: 'rollback', entity: 'person', entityId: before.id, before: current, after: before });
}

export function submitContribution(ds: Dataset, c: Omit<Contribution, 'id' | 'submittedAt' | 'status' | 'history'>): { ds: Dataset; contribution: Contribution } {
  const contribution: Contribution = {
    ...c,
    id: newId('c'),
    submittedAt: new Date().toISOString(),
    status: 'new',
    history: [{ at: new Date().toISOString(), by: c.contributorName, action: 'submitted' }],
  };
  const next = { ...ds, contributions: [contribution, ...ds.contributions] };
  return { ds: audit(next, { actor: c.contributorName, action: 'submit', entity: 'contribution', entityId: contribution.id }), contribution };
}
