# Email Pipeline Explained

This document explains exactly how emails become appointments and bills in Inbox to Week.

---

## The Big Picture

```
Healthcare Email → Gmail Forwarding → Resend → Your App → Database → Plan Page
```

---

## Step-by-Step Flow

### Step 1: User Gets a Unique Forwarding Address

When a user signs up, we automatically generate a unique email address for them:

```javascript
// Example from src/db/queries.js
function generateForwardingAddress(userId) {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `user-${userId}-${randomPart}@yourdomain.com`;
}
```

**Example Result:**
```
user-1-a3f8b2c4d9e1f7g6@carebase.com
```

This address is:
- ✅ Unique to each user (has their user ID + random string)
- ✅ Impossible to guess (cryptographically random)
- ✅ Displayed in the Settings page for easy copying

---

### Step 2: User Sets Up Email Forwarding in Gmail

The user needs to forward healthcare emails to their unique address. There are two ways:

#### Option A: Gmail Filter (Recommended)

1. In Gmail, go to Settings → Filters and Blocked Addresses
2. Create a new filter:
   ```
   From: *@healthcare.com OR *@clinic.com OR subject:(appointment OR bill)
   ```
3. Choose: "Forward it to" → their unique forwarding address
4. Save

**Result:** Only matching healthcare emails get forwarded, keeping inbox clean.

#### Option B: Manual Forwarding

User manually forwards individual emails to their address.

**Result:** Works, but requires manual action each time.

---

### Step 3: Email Arrives at Resend

When someone forwards an email to `user-1-xyz@carebase.com`, here's what happens:

#### DNS Setup (One-time, when adding domain)

Your domain needs these DNS records so emails can reach Resend:

```
# MX Records (tell email servers where to deliver mail)
MX 10 feedback-smtp.us-east-1.amazonses.com
MX 10 feedback-smtp.us-west-2.amazonses.com

# SPF Record (allows Resend to send email on your behalf)
TXT "v=spf1 include:amazonses.com ~all"

# DKIM Record (proves emails are authentic)
TXT "v=DKIM1; k=rsa; p=MIGfMA0GCS..."
```

Resend provides the exact values when you add your domain.

#### Email Routing

Once DNS is set up, Resend receives the email and checks:

1. **Is this domain verified?** ✓
2. **Does the TO address exist in our system?**
   - We don't pre-register addresses
   - Resend accepts ALL emails to `*@carebase.com`
3. **Where should we forward this?**
   - Resend has an "Inbound Route" configured
   - Points to: `https://yourdomain.com/webhook/inbound-email`

---

### Step 4: Resend Calls Your Webhook

Resend makes an HTTP POST request to your webhook with the email data:

```json
POST https://yourdomain.com/webhook/inbound-email
Content-Type: application/json

{
  "from": "appointments@healthcare.com",
  "to": "user-1-a3f8b2c4d9e1f7g6@carebase.com",
  "subject": "Appointment Reminder - Dr. Smith",
  "text": "Your appointment is scheduled for December 15, 2024 at 2:30 PM...",
  "html": "<html>...</html>",
  "messageId": "<abc123@email.com>"
}
```

**Key Fields:**
- `from`: Original sender (the healthcare provider)
- `to`: Your user's forwarding address
- `subject`: Email subject line
- `text`: Plain text body (we use this for parsing)
- `messageId`: Unique identifier for deduplication

---

### Step 5: Your App Receives and Processes the Email

This is where the magic happens. Let's trace through the code:

#### 5.1 Webhook Receives Email

```javascript
// src/routes/webhook.js
router.post('/inbound-email', async (req, res) => {
  const { from, to, subject, text, messageId } = req.body;

  // Find which user this email belongs to
  const userResult = await db.query(
    `SELECT u.*, r.id as recipient_id
     FROM users u
     JOIN recipients r ON u.id = r.user_id
     WHERE u.forwarding_address = $1`,
    [to]  // user-1-xyz@carebase.com
  );

  if (userResult.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }
```

**What happens:**
1. Extract email data from webhook payload
2. Look up user by their forwarding address (`to` field)
3. Get their recipient ID (needed for creating items)

#### 5.2 Store Email Content

```javascript
// Extract short excerpt (first 500 chars)
const shortExcerpt = text ? text.substring(0, 500) : '';

// Store full text if longer (to save space in DB)
let storageKey = null;
if (text && text.length > 500) {
  storageKey = await storeText(text);  // Saves to filesystem
}

// Create source record
const source = await createSource(recipient_id, 'email', {
  externalId: messageId,
  sender: from,
  subject: subject,
  shortExcerpt: shortExcerpt,
  storageKey: storageKey
});
```

**Why this matters:**
- Short emails stored directly in `short_excerpt` column
- Long emails stored in filesystem, only key stored in DB
- Keeps database lean and fast
- `externalId` prevents duplicate processing

#### 5.3 Parse and Classify

```javascript
// src/services/parser.js
const parsed = parseSource(source);

// parsed = {
//   classification: { type: 'appointment', confidence: 0.92 },
//   appointmentData: { startLocal: '...', summary: '...' },
//   billData: null
// }
```

**Parser Logic** (simplified):

```javascript
function classifyText(text) {
  const lowerText = text.toLowerCase();

  // Count keyword matches
  const hasAppointmentWords = ['appointment', 'visit', 'doctor'].some(
    word => lowerText.includes(word)
  );

  const hasBillWords = ['bill', 'payment', 'amount due'].some(
    word => lowerText.includes(word)
  );

  // Check patterns
  const hasTime = /\d{1,2}:\d{2}\s*(am|pm)/i.test(text);
  const hasDate = /Jan|Feb|Mar|...|Dec/i.test(text);
  const hasMoney = /\$\d+/i.test(text);

  // Calculate confidence
  if (hasAppointmentWords && hasTime && hasDate) {
    return { type: 'appointment', confidence: 0.9 };
  }

  if (hasBillWords && hasMoney) {
    return { type: 'bill', confidence: 0.85 };
  }

  return { type: 'noise', confidence: 0.3 };
}
```

**Extraction Examples:**

For appointments:
```javascript
// Input: "Your appointment is on December 15, 2024 at 2:30 PM"
// Output:
{
  startLocal: '2024-12-15T14:30:00',
  endLocal: '2024-12-15T15:30:00',  // Default 1 hour
  location: null,  // Not found in text
  prepNote: null,
  summary: 'Your appointment is on December 15...'
}
```

For bills:
```javascript
// Input: "Amount due: $125.50. Due date: January 15, 2025"
// Output:
{
  amountCents: 12550,
  dueDate: '2025-01-15',
  payUrl: null,  // Not found
  status: 'todo'
}
```

#### 5.4 Create Database Records

```javascript
// Create item (links source to classification)
const item = await createItem(
  source.recipient_id,
  source.id,
  'appointment',  // or 'bill'
  0.92           // confidence score
);

// Create type-specific record
if (classification.type === 'appointment') {
  await createAppointment(item.id, appointmentData);
} else if (classification.type === 'bill') {
  await createBill(item.id, billData);
}

// Log for review
await createAuditLog(item.id, 'auto_classified', {
  type: classification.type,
  confidence: classification.confidence,
  sender: source.sender,
  subject: source.subject
});
```

**Database Structure:**

```
sources (email metadata)
    ↓
items (classification + confidence)
    ↓
appointments OR bills (extracted data)
    ↓
audit (decision log)
```

#### 5.5 Response

```javascript
res.json({ success: true, sourceId: source.id });
```

Resend gets a 200 OK response, confirming email was processed.

---

### Step 6: User Views Plan Page

When user visits `http://localhost:3000/plan`:

```javascript
// src/routes/plan.js

// Get next 7 days
const startDate = new Date();  // Today at midnight
const endDate = new Date(startDate);
endDate.setDate(endDate.getDate() + 7);

// Fetch appointments in date range
const appointments = await getUpcomingAppointments(
  recipient.id,
  startDate.toISOString(),
  endDate.toISOString()
);

// Fetch bills (due in next 7 days OR no due date)
const bills = await getUpcomingBills(
  recipient.id,
  startDate.toISOString(),
  endDate.toISOString()
);

// Render page
res.render('plan', { appointments, bills });
```

**Result:** User sees their parsed appointments and bills!

---

## Complete Example Flow

Let's trace a real email through the entire pipeline:

### Original Email

```
From: appointments@healthcenter.com
To: user-1-a3f8b2c4d9e1f7g6@carebase.com
Subject: Appointment Reminder

Dear Patient,

Your appointment with Dr. Sarah Johnson is scheduled for:

Date: Thursday, December 15, 2024
Time: 2:30 PM
Location: City Medical Center, 123 Health Street, Suite 200

Please arrive 15 minutes early and bring your insurance card.

If you need to reschedule, call 555-1234.

Thank you,
Health Center
```

### Step-by-Step Processing

**1. Email arrives at Resend**
- DNS MX records point to Resend
- Resend accepts email to `@carebase.com`

**2. Webhook called**
```javascript
POST /webhook/inbound-email
{
  from: "appointments@healthcenter.com",
  to: "user-1-a3f8b2c4d9e1f7g6@carebase.com",
  subject: "Appointment Reminder",
  text: "Dear Patient, Your appointment with Dr. Sarah Johnson..."
}
```

**3. User lookup**
```sql
SELECT * FROM users WHERE forwarding_address = 'user-1-a3f8b2c4d9e1f7g6@carebase.com'
-- Returns: user_id = 1, recipient_id = 1
```

**4. Source created**
```sql
INSERT INTO sources (recipient_id, kind, sender, subject, short_excerpt)
VALUES (1, 'email', 'appointments@healthcenter.com', 'Appointment Reminder', 'Dear Patient...')
-- source_id = 42
```

**5. Parser runs**
```javascript
classifyText("Dear Patient, Your appointment with Dr. Sarah Johnson is scheduled for...")

// Finds keywords: "appointment", "scheduled"
// Finds time: "2:30 PM"
// Finds date: "December 15, 2024"
// Result: { type: 'appointment', confidence: 0.95 }

extractAppointment(...)
// Result: {
//   startLocal: '2024-12-15T14:30:00',
//   endLocal: '2024-12-15T15:30:00',
//   location: 'City Medical Center, 123 Health Street, Suite 200',
//   prepNote: 'Please arrive 15 minutes early and bring your insurance card',
//   summary: 'Appointment with Dr. Sarah Johnson'
// }
```

**6. Item created**
```sql
INSERT INTO items (recipient_id, source_id, detected_type, confidence)
VALUES (1, 42, 'appointment', 0.95)
-- item_id = 88
```

**7. Appointment created**
```sql
INSERT INTO appointments (item_id, start_local, end_local, location, prep_note, summary, ics_token)
VALUES (88, '2024-12-15T14:30:00', '2024-12-15T15:30:00', 'City Medical Center...',
        'Please arrive 15 minutes early...', 'Appointment with Dr. Sarah Johnson',
        'a1b2c3d4e5f6...')
-- appointment_id = 29
```

**8. Audit logged**
```sql
INSERT INTO audit (item_id, action, meta)
VALUES (88, 'auto_classified', '{"type":"appointment","confidence":0.95,"sender":"appointments@healthcenter.com"}')
```

**9. User views plan page**
```javascript
// Query finds appointment in next 7 days
SELECT * FROM appointments
WHERE start_local >= '2024-12-08T00:00:00'
  AND start_local < '2024-12-15T00:00:00'

// Rendered in plan.ejs:
```

**Plan Page Shows:**
```
📅 Show Up
┌─────────────────────────────────────────────┐
│ Appointment with Dr. Sarah Johnson          │
│                                             │
│ When: Thursday, December 15, 2024 at 2:30 PM│
│ Where: City Medical Center, 123 Health St   │
│ Prepare: Please arrive 15 minutes early... │
│                                             │
│               [Add to Calendar] ←──────────┐│
└─────────────────────────────────────────────┘│
                                               │
                                               │
When clicked: Downloads appointment-a1b2c3.ics │
                                               │
Opens in: Google Calendar / Apple Calendar ────┘
```

---

## Special Cases

### Duplicate Emails

**Problem:** User forwards same email twice

**Solution:**
```javascript
// We store messageId as external_id
const existingSource = await db.query(
  'SELECT * FROM sources WHERE external_id = $1',
  [messageId]
);

if (existingSource.rows.length > 0) {
  return res.json({ success: true, message: 'Already processed' });
}
```

### Low Confidence Classification

**Problem:** Parser unsure (confidence < 0.7)

**What happens:**
```javascript
// Still creates item, but flags for review
await createItem(recipient_id, source_id, 'noise', 0.45);

// Audit log marks it
await createAuditLog(item_id, 'low_confidence', {
  confidence: 0.45,
  needs_review: true
});

// Admin can query:
SELECT * FROM items WHERE confidence < 0.7;
```

### Long Emails

**Problem:** Email is 5000 characters

**Solution:**
```javascript
// First 500 chars in database
shortExcerpt = text.substring(0, 500);

// Rest stored in filesystem
const storageKey = await storeText(text);  // Returns: "a1b2c3d4e5f6"
// File saved to: uploads/a1b2c3d4e5f6.txt

// Can retrieve later:
const fullText = await retrieveText(storageKey);
```

---

## Troubleshooting

### "Email not showing up"

**Check 1:** Did webhook get called?
```javascript
// Check Resend dashboard → Inbound → Activity
// Should show POST to your webhook URL
```

**Check 2:** Did we find the user?
```sql
-- Check if forwarding address exists
SELECT * FROM users WHERE forwarding_address = 'user-1-xyz@carebase.com';
```

**Check 3:** Was it classified as noise?
```sql
-- Check items table
SELECT * FROM items
WHERE detected_type = 'noise'
ORDER BY created_at DESC
LIMIT 10;
```

**Check 4:** Is it outside 7-day window?
```sql
-- Check appointment dates
SELECT start_local FROM appointments ORDER BY start_local DESC LIMIT 10;
-- Should be within next 7 days from today
```

### "Wrong classification"

**Solution:** Check audit logs
```sql
SELECT i.*, a.meta
FROM items i
JOIN audit a ON i.id = a.item_id
WHERE i.confidence < 0.7;
```

Adjust parser rules in `src/services/parser.js`:
```javascript
// Add more keywords
const APPOINTMENT_KEYWORDS = [
  ...existing,
  'checkup',  // Add new ones
  'consultation'
];
```

### "Duplicate appointments"

**Solution:** Check external_id
```sql
SELECT s.external_id, COUNT(*)
FROM sources s
GROUP BY s.external_id
HAVING COUNT(*) > 1;
```

Should be 0. If not, check webhook deduplication logic.

---

## Security & Privacy

### Email Storage

**We store minimal data:**
- ✅ Sender, subject, first 500 chars
- ❌ Full email body (unless needed, then encrypted in storage)
- ❌ Attachments (not supported in MVP)

### Forwarding Address Security

**Addresses are unguessable:**
```javascript
// Random part has 2^64 possibilities
crypto.randomBytes(8).toString('hex')  // 16 hex chars

// Example: a3f8b2c4d9e1f7g6
// Impossible to brute force
```

### Database Encryption

**Sensitive fields:**
```sql
-- In production, encrypt:
- forwarding_address (contains user ID)
- plan_secret (for family sharing)
```

---

## Performance Considerations

### Webhook Response Time

**Target:** < 1 second

**Why:** Resend expects quick response, will retry if timeout

**Optimization:**
```javascript
// Don't do this:
await parseSource();  // Takes 500ms
await createItem();   // Takes 200ms
res.json({ success: true });

// Do this instead:
res.json({ success: true });  // Respond immediately
await processSource(source);  // Process in background
```

### Database Queries

**Indexes matter:**
```sql
-- Critical indexes (already in schema.sql)
CREATE INDEX idx_sources_recipient_id ON sources(recipient_id);
CREATE INDEX idx_appointments_start_local ON appointments(start_local);
```

Without these, plan page query would be slow with 1000+ appointments.

---

## Testing the Pipeline Locally

Since webhooks need a public URL, you can't test the full pipeline locally. But you can simulate it:

### Simulate Inbound Email

```javascript
// test-webhook.js
const response = await fetch('http://localhost:3000/webhook/inbound-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: 'test@clinic.com',
    to: 'user-1-abc123@carebase.com',  // Use your real forwarding address
    subject: 'Test Appointment',
    text: 'Your appointment is December 20, 2024 at 3:00 PM',
    messageId: 'test-' + Date.now()
  })
});

console.log(await response.json());
```

### Or Use Ngrok for Real Webhooks

```bash
# Terminal 1: Start app
npm run dev

# Terminal 2: Expose to internet
ngrok http 3000

# Copy ngrok URL (e.g., https://abc123.ngrok.io)
# Update Resend webhook: https://abc123.ngrok.io/webhook/inbound-email
# Now real emails will reach your local server!
```

---

## Production Deployment Checklist

Before going live, verify:

- [ ] Domain DNS records configured (MX, SPF, DKIM)
- [ ] Domain verified in Resend dashboard
- [ ] Inbound route points to production webhook URL
- [ ] DATABASE_URL uses production database
- [ ] INBOUND_EMAIL_DOMAIN set to your real domain
- [ ] Webhook endpoint is publicly accessible
- [ ] SSL/HTTPS enabled (required by Resend)
- [ ] Error tracking configured (Sentry, etc.)
- [ ] Test email sent and received successfully

---

## Summary

**The pipeline in one sentence:**

Healthcare provider sends email → Gmail forwards to unique address → Resend receives and calls webhook → App parses and creates appointment/bill → User sees it on plan page.

**Key takeaways:**
- Each user gets a cryptographically random forwarding address
- Resend handles all email delivery and routing
- Your app just processes webhook POSTs with email data
- Parser uses simple rules (no ML needed for MVP)
- Everything logged in audit table for review

**Why this approach works:**
- ✅ Zero configuration needed per user (address auto-generated)
- ✅ User controls what gets forwarded (via Gmail filters)
- ✅ No email credentials stored (Resend handles auth)
- ✅ Scalable (stateless webhook processing)
- ✅ Observable (audit logs for debugging)
