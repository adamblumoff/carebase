export interface RouterMeta {
  basePath: string;
  scope: 'web' | 'api';
  description: string;
}

export interface RouteMeta {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  description: string;
}

export const ROUTER_METADATA: RouterMeta[] = [
  { basePath: '/auth', scope: 'web', description: 'Web auth + session management' },
  { basePath: '/webhook', scope: 'web', description: 'Inbound Postmark webhook' },
  { basePath: '/plan', scope: 'web', description: 'Web plan viewer' },
  { basePath: '/calendar', scope: 'web', description: 'ICS feeds' },
  { basePath: '/upload', scope: 'web', description: 'Web bill upload' },
  { basePath: '/settings', scope: 'web', description: 'Web settings' },
  { basePath: '/review', scope: 'web', description: 'Low-confidence review tools' },
  { basePath: '/collaborators', scope: 'web', description: 'Collaborator invite landing pages' },
  { basePath: '/api/auth', scope: 'api', description: 'Mobile auth APIs' },
  { basePath: '/api/plan', scope: 'api', description: 'Plan data APIs' },
  { basePath: '/api/appointments', scope: 'api', description: 'Appointment CRUD APIs' },
  { basePath: '/api/bills', scope: 'api', description: 'Bill CRUD APIs' },
  { basePath: '/api/upload', scope: 'api', description: 'Mobile photo upload API' },
  { basePath: '/api/collaborators', scope: 'api', description: 'Care team collaborator APIs' },
];

export const API_ROUTE_METADATA: RouteMeta[] = [
  { method: 'GET', path: '/api/auth/session', description: 'Return auth status and user profile' },
  { method: 'POST', path: '/api/auth/logout', description: 'Invalidate current session (mobile)' },
  { method: 'GET', path: '/api/auth/user', description: 'Return authenticated user details' },
  { method: 'POST', path: '/api/auth/mobile-login', description: 'Exchange OAuth token for bearer access token' },
  { method: 'GET', path: '/api/plan', description: 'Retrieve weekly appointments and bills' },
  { method: 'GET', path: '/api/plan/version', description: 'Retrieve latest plan version number + timestamp' },
  { method: 'GET', path: '/api/appointments/:id', description: 'Fetch appointment by id' },
  { method: 'PATCH', path: '/api/appointments/:id', description: 'Update appointment fields' },
  { method: 'DELETE', path: '/api/appointments/:id', description: 'Delete appointment' },
  { method: 'GET', path: '/api/bills/:id', description: 'Fetch bill by id' },
  { method: 'PATCH', path: '/api/bills/:id', description: 'Update bill fields' },
  { method: 'DELETE', path: '/api/bills/:id', description: 'Delete bill' },
  { method: 'POST', path: '/api/bills/:id/mark-paid', description: 'Mark bill as paid' },
  { method: 'POST', path: '/api/upload/photo', description: 'Upload bill photo for OCR + ingestion' },
  { method: 'GET', path: '/api/collaborators', description: 'List collaborators for the active recipient' },
  { method: 'POST', path: '/api/collaborators', description: 'Invite a collaborator by email' },
  { method: 'POST', path: '/api/collaborators/accept', description: 'Accept a collaborator invite' },
];
