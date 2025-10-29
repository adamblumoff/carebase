import type { Appointment, Bill, MedicationDraft } from '@carebase/shared';

export type RootStackParamList = {
  Login: undefined;
  Plan: { medicationDraft?: MedicationDraft | null; focusMedicationId?: number | null } | undefined;
  AppointmentDetail: { appointment: Appointment };
  BillDetail: { bill: Bill };
  Settings: undefined;
  Camera: { intent?: 'bill' | 'medication'; timezone?: string } | undefined;
};
