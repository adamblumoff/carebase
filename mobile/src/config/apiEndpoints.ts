export const API_ENDPOINTS = {
  // Auth
  checkSession: '/api/auth/session',
  logout: '/api/auth/logout',
  getUserInfo: '/api/auth/user',

  // Plan
  getPlan: '/api/plan',
  getPlanVersion: '/api/plan/version',

  // Appointments
  getAppointment: (id: number) => `/api/appointments/${id}`,
  updateAppointment: (id: number) => `/api/appointments/${id}`,
  deleteAppointment: (id: number) => `/api/appointments/${id}`,

  // Bills
  getBill: (id: number) => `/api/bills/${id}`,
  updateBill: (id: number) => `/api/bills/${id}`,
  deleteBill: (id: number) => `/api/bills/${id}`,
  markBillPaid: (id: number) => `/api/bills/${id}/mark-paid`,

  // Medications
  medications: {
    list: '/api/medications',
    create: '/api/medications',
    detail: (id: number) => `/api/medications/${id}`,
    update: (id: number) => `/api/medications/${id}`,
    archive: (id: number) => `/api/medications/${id}/archive`,
    unarchive: (id: number) => `/api/medications/${id}/unarchive`,
    doses: (id: number) => `/api/medications/${id}/doses`,
    dose: (id: number, doseId: number) => `/api/medications/${id}/doses/${doseId}`,
    intakes: (id: number) => `/api/medications/${id}/intakes`,
    intake: (id: number, intakeId: number) => `/api/medications/${id}/intakes/${intakeId}`,
    refill: (id: number) => `/api/medications/${id}/refill`
  },

  // Upload
  uploadPhoto: '/api/upload/photo',

  // Collaborators
  collaborators: {
    list: '/api/collaborators',
    invite: '/api/collaborators',
    accept: '/api/collaborators/accept'
  },

  // Review queue
  review: {
    pending: '/api/review/pending',
    item: (id: number) => `/api/review/${id}`
  },

  // Integrations
  googleIntegration: {
    status: '/api/integrations/google/status',
    connect: '/api/integrations/google/connect',
    sync: '/api/integrations/google/sync'
  }
} as const;
