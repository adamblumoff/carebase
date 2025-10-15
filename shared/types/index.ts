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

export interface Item {
  id: number;
  recipientId: number;
  sourceId: number;
  detectedType: ItemType;
  confidence: number; // 0.0 to 1.0
  createdAt: Date;
}

// ========== APPOINTMENTS ==========

export interface Appointment {
  id: number;
  itemId: number;
  startLocal: Date;
  endLocal: Date;
  location: string | null;
  prepNote: string | null;
  summary: string;
  icsToken: string;
  createdAt: Date;
  assignedCollaboratorId: number | null;
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
  location?: string;
  prepNote?: string;
  summary: string;
}

export interface AppointmentUpdateRequest {
  startLocal?: string;
  endLocal?: string;
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

export type CollaboratorRole = 'owner' | 'contributor';
export type CollaboratorStatus = 'pending' | 'accepted';

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
