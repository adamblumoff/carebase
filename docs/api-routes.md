# API Route Registry

Generated 2025-10-15T23:41:01.203Z

## Routers

| Base Path | Scope | Description |
| --- | --- | --- |
| /auth | web | Web auth + session management |
| /webhook | web | Inbound Postmark webhook |
| /plan | web | Web plan viewer |
| /calendar | web | ICS feeds |
| /upload | web | Web bill upload |
| /settings | web | Web settings |
| /review | web | Low-confidence review tools |
| /collaborators | web | Collaborator invite landing pages |
| /api/auth | api | Mobile auth APIs |
| /api/plan | api | Plan data APIs |
| /api/appointments | api | Appointment CRUD APIs |
| /api/bills | api | Bill CRUD APIs |
| /api/upload | api | Mobile photo upload API |
| /api/collaborators | api | Care team collaborator APIs |
| /api/integrations/google | api | Google Calendar integration APIs |

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | /api/auth/session | Return auth status and user profile |
| POST | /api/auth/logout | Invalidate current session (mobile) |
| GET | /api/auth/user | Return authenticated user details |
| POST | /api/auth/mobile-login | Exchange OAuth token for bearer access token |
| GET | /api/plan | Retrieve weekly appointments and bills |
| GET | /api/plan/version | Retrieve latest plan version number + timestamp |
| GET | /api/appointments/:id | Fetch appointment by id |
| PATCH | /api/appointments/:id | Update appointment fields |
| DELETE | /api/appointments/:id | Delete appointment |
| GET | /api/bills/:id | Fetch bill by id |
| PATCH | /api/bills/:id | Update bill fields |
| DELETE | /api/bills/:id | Delete bill |
| POST | /api/bills/:id/mark-paid | Mark bill as paid |
| POST | /api/upload/photo | Upload bill photo for OCR + ingestion |
| GET | /api/collaborators | List collaborators for the active recipient |
| POST | /api/collaborators | Invite a collaborator by email |
| POST | /api/collaborators/accept | Accept a collaborator invite |
| GET | /api/integrations/google/status | Fetch Google integration status for the user |
| POST | /api/integrations/google/connect/start | Generate Google OAuth URL for calendar sync (mobile) |
| POST | /api/integrations/google/connect | Store Google OAuth tokens and trigger initial sync |
| DELETE | /api/integrations/google/connect | Disconnect Google Calendar integration |
| POST | /api/integrations/google/sync | Manually trigger Google Calendar sync |
| GET | /api/integrations/google/callback | OAuth callback endpoint for Google Calendar integration |
