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
