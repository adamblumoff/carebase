# Inbox to Week MVP execution outline

This file guides an AI CLI to create the first web version of Inbox to Week. It keeps scope tiny, builds trust, and prepares the later mobile app.

## Objective
Create a simple web app that turns healthcare emails and photos into one weekly plan with two actions  
Pay and Show up  
Zero typing after setup  
Calendar add through ICS files only

## Deliverables
1. Deployed web app with Google sign in
2. One read only plan page for a single care recipient that shows next week
3. Photo upload for paper bills
4. Inbound email intake through a unique forwarding address per user
5. Friday digest email
6. Private ICS links for Add to calendar
7. Postgres database and private object storage
8. Minimal rules based parser with audit logging
9. Delete account flow

## Systems to provision
1. Web hosting and server functions
2. Postgres database
3. Private file storage for uploads and text blobs
4. Email provider with inbound webhooks and outbound sending
5. OCR service
6. Error tracking and lightweight analytics

## Authentication and identity
1. Google sign in with profile scope only
2. On first login create a user record and a default recipient record
3. Issue a long random secret for sharing the plan page with family during the pilot

## Data model plan
1. Users table stores id email google id created at
2. Recipients table stores id user id display name
3. Sources table stores id recipient id kind email or upload external id sender subject short excerpt created at
4. Items table stores id recipient id source id detected type appointment or bill or noise confidence
5. Appointments table stores id item id start local end local location prep note summary ics token
6. Bills table stores id item id statement date amount cents due date pay url status todo or paid or ignore task key
7. Audit table stores id item id action meta created at

## Email intake plan
1. Generate a unique forwarding address per user
2. Show that address in settings with a copy button and a setup tip to forward a Gmail label
3. Inbound webhook accepts sender subject and plain text body
4. Store only a short excerpt and a storage key for any larger body text
5. Create a source row and enqueue a parse job

## Photo upload plan
1. Authenticated users can upload a single image under a tight size cap
2. Store the file and call OCR
3. Save the first lines of OCR text as the short excerpt
4. Create a source row and enqueue a parse job

## Parsing and classification
1. Classify each source as appointment or bill or noise with a confidence score using rules that check date words time expressions money amounts and common phrases
2. For appointment extract date time location and a prep line and build start and end in local time using a default visit length
3. For bill extract statement date amount due due date and any pay link text
4. Create an item row and a child row in appointments or bills as appropriate
5. Write an audit row with sender subject type confidence and action taken
6. If confidence is low flag for manual review in an internal review view

## Plan page
1. Route that renders next seven days for the active recipient
2. Two sections only  
   * Appointments with time location prep and an Add to calendar link  
   * Bills with amount due due date status and Pay link if present
3. Accept a secret token in the URL for family access during the pilot
4. No editing on this page

## ICS link
1. Route that serves an ICS file by ics token
2. Include start end summary location and description
3. Calendar write scopes are not used

## Friday digest
1. Scheduled route runs once a week in the user time zone window
2. For each recipient gather next seven days and send a tidy HTML email mirroring the plan page
3. Include one button that opens the plan page with the secret token

## Settings
1. Show the unique forwarding address with a copy button
2. Show the plan page share link with the secret token
3. Provide a delete account button with a strong confirm step

## Privacy and security rules
1. Store minimal email content  
   sender subject short excerpt message id or storage key
2. Keep uploads private with signed access only
3. Encrypt tokens and phone numbers at rest
4. Delete account removes user rows child rows and stored files within one day
5. Log only necessary analytics events such as created appointment created bill opened digest and plan page view

## Observability
1. Error tracking for server and client
2. Analytics events for key funnel steps and weekly usage

## Acceptance tests the CLI must run
1. Sign in creates a user and recipient record
2. Posting a clinic email creates an appointment and the plan page shows it with a valid Add to calendar link
3. Posting a billing email creates a bill with amount and due date and the plan page shows it with a Pay link if present
4. Uploading a photo of a bill creates a bill after OCR and appears on the plan page
5. The Friday digest route sends one email that lists next week and links to the plan page
6. Delete account removes the user data and returns to the landing page

## Pilot run checklist
1. Create two seed users and confirm forwarding addresses work
2. Send one sample clinic email and one sample billing email for each user
3. Verify plan pages render correctly and ICS imports into calendars
4. Enable the weekly digest and confirm delivery
5. Invite two real families and monitor audit logs for low confidence items

## Metrics to compute weekly
1. Auto capture hit rate for the last seven days
2. On time bill rate for items with due dates
3. Missed visit rate from a simple Monday check in
4. Weekly active rate defined as plan or digest opens
5. Referral share based on plan link shares or invite codes

## Launch gates
1. Two real families used the product for two weeks
2. At least sixty percent of new items auto captured without manual review
3. At least ninety percent of bills in the plan paid by their due date
4. Families confirm the plan page and the digest reduced coordination time

## Post launch next inch
1. Add medication list from a pill bottle photo with refill countdowns
2. Add support for standard portal export files
3. Add bank connection only to confirm that a bill marked paid actually cleared
