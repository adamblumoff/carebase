export {
  __setGoogleSyncSchedulerForTests,
  __testTouchPlanForItem,
  touchPlanForItem,
  touchPlanForUser,
  getPlanVersion
} from './queries/plan.js';

export {
  __setGoogleIntegrationSchemaEnsuredForTests,
  GOOGLE_SYNC_PROJECTION,
  clearGoogleSyncForUser,
  deleteGoogleCredential,
  deleteGoogleSyncLink,
  findGoogleSyncLinkByEvent,
  listGoogleCredentialUsers,
  getGoogleCredential,
  getGoogleCredentialByClerkUserId,
  setGoogleCredentialClerkUserId,
  getGoogleIntegrationStatus,
  getGoogleSyncMetadataForItem,
  getItemOwnerUserId,
  hydrateAppointmentWithGoogleSync,
  hydrateBillWithGoogleSync,
  upsertGoogleWatchChannel,
  deleteGoogleWatchChannel,
  findGoogleWatchChannelByResource,
  findGoogleWatchChannelByUser,
  findGoogleWatchChannelById,
  findGoogleWatchChannelByToken,
  listExpiringGoogleWatchChannels,
  listGoogleWatchChannelsByUser,
  setGoogleWatchChannelsClerkUserId,
  listGoogleConnectedUserIds,
  listPendingGoogleSyncItems,
  listGoogleSyncLinksForUser,
  markGoogleSyncError,
  markGoogleSyncPending,
  markGoogleSyncSuccess,
  queueGoogleSyncForUser,
  setGoogleCredentialReauth,
  upsertGoogleCredential,
  upsertGoogleSyncLink
} from './queries/google.js';
export type {
  GoogleCredential,
  GoogleCredentialUserRow,
  GoogleSyncLinkUpsertData,
  GoogleWatchChannel
} from './queries/google.js';

export {
  acceptCollaboratorInvite,
  createCollaboratorInvite,
  ensureOwnerCollaborator,
  findCollaboratorById,
  findCollaboratorByToken,
  findCollaboratorForRecipient,
  findRecipientForCollaborator,
  hasCollaboratorInviteForEmail,
  listCollaborators,
  listAcceptedCollaboratorEmailsForOwner,
  resolveRecipientContextForUser
} from './queries/collaborators.js';

export {
  createUser,
  createUserWithEmail,
  deleteUser,
  findUserByEmail,
  findUserByGoogleId,
  findUserByLegacyGoogleId,
  findUserByClerkUserId,
  findUserById,
  setClerkUserId,
  setPasswordResetRequired,
  getUserForClerkBackfill,
  listUsersForClerkBackfill,
  getUserMfaStatus,
  upsertUserMfaStatus
} from './queries/users.js';

export {
  createRecipient,
  findRecipientById,
  findRecipientsByUserId
} from './queries/recipients.js';

export { createSource, findSourceById } from './queries/sources.js';
export type { CreateSourceData } from './queries/sources.js';

export {
  createItem,
  findItemById,
  findItemsByRecipientId
} from './queries/items.js';

export {
  createAppointment,
  deleteAppointment,
  findAppointmentByIcsToken,
  getAppointmentById,
  getAppointmentByIdForRecipient,
  getAppointmentByItemId,
  getUpcomingAppointments,
  updateAppointment,
  updateAppointmentForRecipient
} from './queries/appointments.js';

export {
  createBill,
  deleteBill,
  getBillById,
  getBillByIdForRecipient,
  getBillByItemId,
  getUpcomingBills,
  updateBill,
  updateBillForRecipient,
  updateBillStatus,
  updateBillStatusForRecipient
} from './queries/bills.js';

export {
  archiveMedication,
  createMedication,
  createMedicationDose,
  createMedicationIntake,
  deleteMedication,
  deleteMedicationDose,
  deleteMedicationIntake,
  deleteMedicationRefillProjection,
  getMedicationById,
  getMedicationForRecipient,
  getMedicationIntake,
  countMedicationIntakesByOccurrence,
  findMedicationIntakeByDoseAndDate,
  getMedicationDoseById,
  getMedicationRefillProjection,
  listMedicationDoses,
  listMedicationIntakes,
  listMedicationOccurrences,
  listMedicationIntakeEvents,
  listActiveMedications,
  insertMedicationIntakeEvent,
  listMedicationsForRecipient,
  unarchiveMedication,
  updateMedication,
  updateMedicationDose,
  updateMedicationIntake,
  upsertMedicationRefillProjection
} from './queries/medications.js';
export type {
  MedicationWriteData,
  MedicationDoseWriteData,
  MedicationDoseUpdateData,
  MedicationIntakeWriteData,
  MedicationIntakeUpdateData
} from './queries/medications.js';
export {
  createMedicationReminderEvent,
  cancelPendingMedicationRemindersForIntake,
  getPendingMedicationReminderForIntake
} from './queries/medicationReminders.js';

export { createAuditLog, getLowConfidenceItems, reclassifyItem } from './queries/audit.js';
export type { LowConfidenceItemRow } from './queries/audit.js';

export {
  upsertBillDraft,
  deleteBillDraft,
  getBillDraftByItemId,
  listPendingReviewItemsForUser,
  getPendingReviewItemForUser,
  updateItemReviewStatus
} from './queries/review.js';
