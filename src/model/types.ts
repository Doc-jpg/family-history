// Core data model. Every entity has a stable id (never a name).
// Confidence and status fields are first-class so the UI can always show
// what is verified, what is a guess, and what is still unresearched.

export type Confidence = 'verified' | 'likely' | 'tentative' | 'unresearched';
export type Branch = 'self' | 'paternal' | 'maternal' | 'both' | 'household' | 'inlaw' | 'unknown'; // inlaw = the spouse's own ancestry (the children's other side)
export type RelationshipStatus = 'verified' | 'unverified' | 'disputed';

export interface DateValue {
  year?: number;
  month?: number; // 1-12
  day?: number;
  approx?: boolean; // "about 1902"
  text?: string; // free text when the date is only known loosely ("spring 1880")
}

export interface Person {
  id: string;
  givenNames: string; // "Jane Mary"
  surname: string; // "Smith"
  maidenName?: string;
  altNames?: string[];
  sex?: 'M' | 'F' | 'X';
  living: 'yes' | 'no' | 'unknown';
  branch: Branch;
  generation: number; // 0 = the root person, 1 = parents, 2 = grandparents, -1 = children
  bio?: string;
  occupations?: string[];
  confidence: Confidence;
  placeholder: boolean;
  /** Set only on a redacted copy for a relative: which kinds of fact the full record holds for this person, so the "fill in the blanks" list does not ask for what is already known but withheld. */
  recorded?: ('parents' | 'birth' | 'death' | 'residence' | 'occupation' | 'photo' | 'bio' | 'maidenName')[]; // true = a slot waiting for a real person; never shown as fact
  portraitMediaId?: string;
  notes?: string;
  privacy: 'private' | 'family' | 'shareable'; // what may be shown to invited relatives
  openQuestions?: string[];
  updatedAt: string;
}

export interface Relationship {
  id: string;
  type: 'parent-child' | 'partner';
  fromId: string; // parent-child: parent; partner: either
  toId: string; // parent-child: child; partner: the other
  subtype?: 'biological' | 'adoptive' | 'step' | 'foster' | 'marriage' | 'partnership';
  status: RelationshipStatus;
  start?: DateValue; // marriage date etc.
  end?: DateValue;
  sourceIds: string[];
  notes?: string;
}

export type EventType =
  | 'birth'
  | 'death'
  | 'burial'
  | 'marriage'
  | 'divorce'
  | 'residence'
  | 'immigration'
  | 'naturalization'
  | 'military'
  | 'occupation'
  | 'education'
  | 'census'
  | 'other';

export interface LifeEvent {
  id: string;
  type: EventType;
  personIds: string[];
  date?: DateValue;
  placeId?: string;
  description?: string;
  sourceIds: string[];
  confidence: Confidence;
}

export interface Place {
  id: string;
  name: string; // "St. Luke's Hospital, Kansas City, Missouri"
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  lng?: number;
  modernName?: string;
  historicalName?: string;
  notes?: string;
}

export interface Source {
  id: string;
  title: string;
  repository?: string; // FamilySearch, Find a Grave, Missouri State Archives, "told by a relative"
  url?: string;
  citation?: string;
  accessedOn?: string; // ISO date
  confidence: Confidence;
  conflicts?: string;
  notes?: string;
}

export interface Media {
  id: string;
  kind: 'photo' | 'document' | 'audio' | 'video' | 'letter';
  title: string;
  storagePath?: string; // Supabase storage path (private bucket)
  dataUrl?: string; // local mode only
  personIds: string[];
  dateText?: string;
  caption?: string;
  privacy: 'private' | 'family' | 'shareable';
  unidentifiedFaces?: boolean;
}

export interface ResearchQuestion {
  id: string;
  title: string;
  personIds: string[];
  status: 'open' | 'in-progress' | 'answered' | 'parked';
  priority: 'high' | 'normal' | 'low';
  notes?: string;
  createdAt: string;
}

export type Role = 'viewer' | 'contributor' | 'editor';

export interface AccessScope {
  branches: Branch[]; // which branches they may see
  personIds: string[]; // extra specific people
  includeLivingDetails: boolean; // detailed birth info for living people
}

export interface Invitation {
  id: string;
  recipientName: string;
  personId?: string; // the relative in the tree, if they are in it
  email?: string;
  deliveryNote?: string; // "text message", etc.
  role: Role;
  scope: AccessScope;
  tokenHash: string; // sha256 of the raw token; the raw token is only ever in the link
  codeHash: string; // sha256 of the one-time code given separately
  status: 'pending' | 'active' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
  activatedAt?: string;
  lastSeenAt?: string;
  verifiedIdentity?: string; // email that completed verification
  // What happens when the link is opened on a device other than the one that first unlocked it:
  // 'view' = opens view-only with no code (default), 'view-with-code' = view-only after the code,
  // 'refuse' = does not open at all. Contributing is always limited to the first device.
  forwarded?: 'view' | 'view-with-code' | 'refuse';
  deviceHash?: string; // sha256 of the first device's id; once set, contributing works only there
  boundAt?: string;
  deviceLabel?: string; // e.g. "iPhone Safari", for the admin's eyes
  releasedAt?: string; // when the admin last pressed Release, so a stale server binding does not come back
  codeAttempts?: number; // wrong codes entered since the last successful open; locked at MAX_CODE_ATTEMPTS
}

// Someone who opened a link that is not theirs (or no link at all) and asked for their own.
export interface AccessRequest {
  id: string;
  name: string;
  relationship: string; // "the root person's aunt", "Mom's brother"
  email?: string;
  phone?: string;
  message?: string;
  viaInvitationId?: string; // the invitation whose link they tried
  personId?: string; // "I am this person in the tree": a grant is centered on them
  deviceHash?: string;
  submittedAt: string;
  status: 'new' | 'granted' | 'declined';
  grantedInvitationId?: string;
  reviewNote?: string;
}

export type ContributionKind =
  | 'memory'
  | 'correction'
  | 'identify-photo'
  | 'missing-person'
  | 'relationship'
  | 'upload'
  | 'context'
  | 'oral-history'
  | 'location'
  | 'annotation'
  | 'dispute'
  | 'lead'
  | 'branch-note';

export type ContributionStatus =
  | 'new'
  | 'approved'
  | 'research'
  | 'clarify'
  | 'partial'
  | 'rejected'
  | 'disputed';

export interface Contribution {
  id: string;
  invitationId: string;
  contributorName: string;
  contributorIdentity?: string;
  submittedAt: string;
  kind: ContributionKind;
  subject: { type: 'person' | 'event' | 'place' | 'media' | 'relationship' | 'branch'; id?: string; label: string };
  proposal: string; // what they are proposing, in their words
  fields?: Record<string, string>; // structured values when the form had them
  reasoning?: string; // why they believe it
  attachmentMediaIds: string[];
  status: ContributionStatus;
  reviewNotes?: string;
  history: { at: string; by: string; action: string; note?: string }[];
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Pencil and pen. A fact told by one relative is "pencil"; a second, different relative
 * confirming it makes it "pen"; a dispute drops it back to pencil until confirmations
 * outnumber disputes by two or the admin settles it. A documented record (a certificate,
 * census, obituary) is pen on its own and a dispute against it is a research flag, not a
 * reversal. Attestations are kept per person (optionally per field) and the standing is
 * computed, never stored, so the rules can change without touching the data.
 */
export interface Attestation {
  id: string;
  personId: string;
  field?: string; // 'name' | 'birth' | 'death' | 'parents' | 'spouse' | 'children' | 'general'
  by: string; // invitation id, or 'admin'
  byName: string;
  stance: 'confirm' | 'dispute';
  note?: string;
  at: string;
  resolvedAt?: string; // a dispute the admin settled (kept for the record, no longer counted)
  resolution?: string;
}

export type Standing = 'documented' | 'pen' | 'pencil' | 'disputed' | 'unattested';

export interface Dataset {
  schemaVersion: 1;
  attestations?: Attestation[];
  people: Person[];
  relationships: Relationship[];
  events: LifeEvent[];
  places: Place[];
  sources: Source[];
  media: Media[];
  questions: ResearchQuestion[];
  invitations: Invitation[];
  contributions: Contribution[];
  accessRequests: AccessRequest[];
  audit: AuditEntry[];
  settings: Settings;
}

export interface Settings {
  familyName: string;
  rootPersonId: string;
  colors: { paternal: string; maternal: string; self: string; household: string; unknown: string; inlaw?: string };
  theme: 'parchment' | 'ink' | 'linen';
  seedVersion?: number; // bumped when the shipped seed gains facts; the store merges them into older local copies
}
