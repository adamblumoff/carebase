/**
 * Shared TypeScript types for Carebase
 * Used by both backend and mobile apps
 */

// ========== USERS ==========

export interface User {
  id: number;
  email: string;
  googleId: string;
  forwardingAddress: string;
  planSecret: string;
  planVersion: number;
  planUpdatedAt: Date;
  createdAt: Date;
}

// ========== RECIPIENTS ==========

export interface Recipient {
  id: number;
  userId: number;
  displayName: string;
  createdAt: Date;
}

// ========== SOURCES ==========

export type SourceKind = 'email' | 'upload';

export interface Source {
  id: number;
  recipientId: number;
  kind: SourceKind;
  externalId: string | null;
  sender: string | null;
  subject: string | null;
  shortExcerpt: string | null;
  storageKey: string | null;
  createdAt: Date;
}

// ========== ITEMS ==========

export type ItemType = 'appointment' | 'bill' | 'noise';
export type ItemReviewStatus = 'auto' | 'pending_review';

export interface Item {
  id: number;
  recipientId: number;
  sourceId: number;
  detectedType: ItemType;
  confidence: number; // 0.0 to 1.0
  reviewStatus: ItemReviewStatus;
  createdAt: Date;
}

export interface PendingReviewDraft {
  amount: number | null;
  dueDate: string | null;
  statementDate: string | null;
  payUrl: string | null;
  status: BillStatus;
  notes: string | null;
}

export interface PendingReviewItemSource {
  id: number;
  subject: string | null;
  sender: string | null;
  shortExcerpt: string | null;
  storageKey: string | null;
}

export interface PendingReviewRecipient {
  id: number;
  displayName: string;
}

export interface PendingReviewItem {
  itemId: number;
  detectedType: ItemType;
  confidence: number;
  createdAt: string;
  recipient: PendingReviewRecipient;
  source: PendingReviewItemSource;
  draft: PendingReviewDraft | null;
}

export interface PendingReviewListResponse {
  items: PendingReviewItem[];
}

// ========== GOOGLE SYNC ==========

export type GoogleSyncDirection = 'push' | 'pull';
export type GoogleSyncStatus = 'idle' | 'pending' | 'error';

export interface GoogleSyncMetadata {
  calendarId: string | null;
  eventId: string | null;
  etag: string | null;
  lastSyncedAt: Date | null;
  lastSyncDirection: GoogleSyncDirection | null;
  localHash: string | null;
  remoteUpdatedAt: Date | null;
  syncStatus: GoogleSyncStatus;
  lastError: string | null;
}

export interface GoogleIntegrationStatus {
  connected: boolean;
  calendarId: string | null;
  lastSyncedAt: Date | null;
  syncPendingCount: number;
  lastError: string | null;
}

// ========== APPOINTMENTS ==========

export interface Appointment {
  id: number;
  itemId: number;
  startLocal: Date;
  endLocal: Date;
  startTimeZone: string | null;
  endTimeZone: string | null;
  startOffset: string | null;
  endOffset: string | null;
  location: string | null;
  prepNote: string | null;
  summary: string;
  icsToken: string;
  createdAt: Date;
  assignedCollaboratorId: number | null;
  googleSync: GoogleSyncMetadata | null;
}

export interface AppointmentPayload extends Omit<Appointment, 'startLocal' | 'endLocal' | 'createdAt'> {
  startLocal: string;
  endLocal: string;
  createdAt: string;
}

// ========== BILLS ==========

export type BillStatus = 'todo' | 'overdue' | 'paid';

export interface Bill {
  id: number;
  itemId: number;
  statementDate: Date | null;
  amount: number | null; // Decimal amount in dollars
  dueDate: Date | null;
  payUrl: string | null;
  status: BillStatus;
  taskKey: string;
  createdAt: Date;
  assignedCollaboratorId: number | null;
  googleSync: GoogleSyncMetadata | null;
}

export interface BillPayload extends Omit<Bill, 'statementDate' | 'dueDate' | 'createdAt'> {
  statementDate: string | null;
  dueDate: string | null;
  createdAt: string;
}

// ========== AUDIT ==========

export interface AuditLog {
  id: number;
  itemId: number | null;
  action: string;
  meta: Record<string, any>;
  createdAt: Date;
}

// ========== API REQUEST/RESPONSE TYPES ==========

export interface AppointmentCreateRequest {
  startLocal: string; // ISO string
  endLocal: string; // ISO string
  startTimeZone?: string | null;
  endTimeZone?: string | null;
  location?: string;
  prepNote?: string;
  summary: string;
}

export interface AppointmentUpdateRequest {
  startLocal?: string;
  endLocal?: string;
  startTimeZone?: string | null;
  endTimeZone?: string | null;
  location?: string;
  prepNote?: string;
  summary?: string;
  assignedCollaboratorId?: number | null;
}

export interface BillCreateRequest {
  statementDate?: string; // ISO string (date only)
  amount?: number;
  dueDate?: string; // ISO string (date only)
  payUrl?: string;
  status?: BillStatus;
}

export interface BillUpdateRequest {
  statementDate?: string;
  amount?: number;
  dueDate?: string;
  payUrl?: string;
  status?: BillStatus;
  assignedCollaboratorId?: number | null;
}

export type BillUpdateData = BillUpdateRequest;

export interface ReclassifyRequest {
  newType: ItemType;
}

// ========== API RESPONSES ==========

export interface UserResponse {
  user: User;
  recipient: Recipient;
}

export interface AppointmentListResponse {
  appointments: Appointment[];
}

export interface BillListResponse {
  bills: Bill[];
}

export interface ReviewItemResponse {
  item: Item;
  source: Source;
}

export interface ReviewListResponse {
  items: Array<{
    item: Item;
    source: Source;
  }>;
}

// ========== COLLABORATORS ==========

export const COLLABORATOR_ROLES = ['owner', 'contributor'] as const;
export type CollaboratorRole = typeof COLLABORATOR_ROLES[number];
export const COLLABORATOR_STATUSES = ['pending', 'accepted'] as const;
export type CollaboratorStatus = typeof COLLABORATOR_STATUSES[number];

export interface Collaborator {
  id: number;
  recipientId: number;
  email: string;
  userId: number | null;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  inviteToken: string;
  invitedBy: number;
  invitedAt: Date;
  acceptedAt: Date | null;
}

export interface CollaboratorPayload extends Omit<Collaborator, 'invitedAt' | 'acceptedAt'> {
  invitedAt: string;
  acceptedAt: string | null;
}

export interface PlanPayload {
  recipient: {
    id: number;
    displayName: string | null;
  };
  dateRange: {
    start: string;
    end: string;
  };
  appointments: AppointmentPayload[];
  bills: BillPayload[];
  planVersion: number;
  planUpdatedAt: string | null;
  collaborators: CollaboratorPayload[];
}

export interface CollaboratorInviteRequest {
  email: string;
  role?: CollaboratorRole;
}

export interface CollaboratorInviteResponse {
  collaborator: Collaborator;
}

export interface CollaboratorListResponse {
  collaborators: Collaborator[];
}

export interface CollaboratorAcceptRequest {
  token: string;
}

export interface CollaboratorAssignRequest {
  collaboratorId: number | null;
}

export interface UploadPhotoResponse {
  success: boolean;
  classification: {
    detectedType: ItemType;
    confidence: number;
  };
  item: Item;
  bill: Bill | null;
  extracted: BillCreateRequest | null;
  overdue: boolean;
  ocr: {
    preview: string;
    storageKey: string | null;
    length: number;
  };
}
