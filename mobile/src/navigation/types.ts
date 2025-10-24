import type { Appointment, Bill } from '@carebase/shared';

export type RootStackParamList = {
  Login: undefined;
  Plan: undefined;
  AppointmentDetail: { appointment: Appointment };
  BillDetail: { bill: Bill };
  Settings: undefined;
  Camera: undefined;
};
