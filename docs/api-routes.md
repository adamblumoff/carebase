# API Route Registry

Generated 2025-10-14T21:56:49.918Z

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
| /api/auth | api | Mobile auth APIs |
| /api/plan | api | Plan data APIs |
| /api/appointments | api | Appointment CRUD APIs |
| /api/bills | api | Bill CRUD APIs |
| /api/upload | api | Mobile photo upload API |

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
