# Postmark Inbound Email Setup

Complete guide to set up Postmark for receiving emails.

---

## Step 1: Sign Up for Postmark

1. Go to https://postmarkapp.com/
2. Click **"Sign up free"**
3. Create account (no credit card needed for trial)
4. Verify your email

**Free Trial:**
- 100 emails free
- Then $15/month for 10,000 emails
- Inbound included

---

## Step 2: Create a Server

After signing in:

1. Click **"Servers"** in left sidebar (or it might auto-create one)
2. If needed, click **"+ Create Server"**
3. Name it: `Inbox to Week`
4. Select **"Transactional"** type
5. Click **"Create Server"**

---

## Step 3: Get Your API Tokens

1. In your server, click **"API Tokens"** tab
2. You'll see two tokens:
   - **Server API Token** (for sending emails) - starts with a long string
   - Copy this token - we'll use it for sending digest emails

---

## Step 4: Set Up Inbound Email

### 4.1: Add Your Domain

1. Click **"Inbound"** in left sidebar (or in your server settings)
2. Click **"Add Domain"** or **"Get Started"**
3. Enter your domain: `carebase.dev`

### 4.2: Configure DNS Records

Postmark will show you MX records to add to your domain:

```
Priority  Hostname         Points to
10        carebase.dev     inbound.postmarkapp.com
```

**Where to add this:**
- Go to your domain registrar (where you bought carebase.dev)
- Find DNS settings
- Add the MX record:
  - **Type:** MX
  - **Name/Host:** @ (or leave blank, or carebase.dev)
  - **Priority:** 10
  - **Value/Points to:** inbound.postmarkapp.com
  - **TTL:** 3600 (or Auto)

**Save and wait:**
- DNS propagation: 5-30 minutes
- Postmark will show "Verified" when ready

### 4.3: Create Inbound Stream

1. Still in **"Inbound"** section
2. Click **"Add Inbound Stream"** or it might be auto-created
3. Configure:
   - **Stream Name:** "Main Inbound"
   - **Color:** Pick any
4. Click **"Create Stream"**

### 4.4: Set Up Webhook

1. In your inbound stream, find **"Webhook"** section
2. Enter your webhook URL:
   ```
   https://your-railway-url.up.railway.app/webhook/inbound-email
   ```
   (Replace with your actual Railway URL)
3. Click **"Save"**

---

## Step 5: Test the Configuration

### 5.1: Check MX Records

```bash
# On your computer, check if MX is set up
dig MX carebase.dev

# Should show:
# carebase.dev.  3600  IN  MX  10 inbound.postmarkapp.com.
```

Or use: https://mxtoolbox.com/SuperTool.aspx?action=mx%3acarebase.dev

### 5.2: Send Test Email

1. From any email account (Gmail, etc.)
2. Send an email to: `test@carebase.dev`
3. In Postmark dashboard → **Inbound** → **Activity**
4. You should see the email appear

If it shows up in Postmark Activity, DNS is working!

---

## Step 6: Update Your Application

### 6.1: Install Postmark SDK (Optional)

We don't need their SDK for inbound (webhook is plain HTTP), but for sending digest emails:

```bash
npm install postmark
```

### 6.2: Update Environment Variables

In Railway (and local `.env`):

```env
# Email (Postmark)
POSTMARK_SERVER_TOKEN=your-server-api-token-here
INBOUND_EMAIL_DOMAIN=carebase.dev

# Keep for reference
RESEND_API_KEY=re_WdmgGr6Q_Jxg33srF9GT1hdz9HSNfiPtd
```

**Note:** We'll keep Resend API key in case you want to switch back, but we'll use Postmark going forward.

---

## Step 7: Understanding Postmark's Webhook Format

When Postmark receives an email to `user-1-xyz@carebase.dev`, it sends a POST to your webhook:

### Webhook Payload (JSON):

```json
{
  "FromName": "Healthcare Clinic",
  "FromFull": {
    "Email": "appointments@healthcare.com",
    "Name": "Healthcare Clinic"
  },
  "From": "appointments@healthcare.com",
  "To": "user-1-a3f8b2c4@carebase.dev",
  "ToFull": [
    {
      "Email": "user-1-a3f8b2c4@carebase.dev",
      "Name": ""
    }
  ],
  "Subject": "Appointment Reminder",
  "MessageID": "abc123-def456-789",
  "Date": "Thu, 09 Oct 2025 12:34:56 -0400",
  "TextBody": "Your appointment is scheduled for...",
  "HtmlBody": "<html>...</html>",
  "StrippedTextReply": "Your appointment is scheduled...",
  "Tag": "",
  "Headers": [...],
  "Attachments": []
}
```

### Key Differences from Resend:

| Field | Postmark | Resend (old) |
|-------|----------|--------------|
| Sender | `From` | `from` |
| Recipient | `To` | `to` |
| Subject | `Subject` | `subject` |
| Body | `TextBody` | `text` |
| Message ID | `MessageID` | `messageId` |

We need to update the webhook handler!

---

## Step 8: Verify Webhook is Being Called

### In Postmark:

1. **Inbound** → **Activity**
2. Send a test email to `test@carebase.dev`
3. Click on the email in Activity
4. Look for **"Webhook Attempts"** section
5. Should show:
   - ✅ 200 OK (success)
   - Or error with details

### In Railway:

```bash
# Check your app logs
railway logs

# Should show:
# "Inbound email webhook: { from: '...', to: '...', subject: '...' }"
```

---

## Troubleshooting

### "Email not showing in Postmark Activity"

**Check MX records:**
```bash
dig MX carebase.dev
```

Should point to `inbound.postmarkapp.com`

**DNS not propagated yet:**
- Wait 30 minutes
- Try again
- Check with multiple DNS checkers

### "Webhook showing 404 or 500 error"

**Check Railway deployment:**
- Is app running? `railway logs`
- Is URL correct in Postmark webhook settings?
- Is `/webhook/inbound-email` route registered?

### "Postmark receives but webhook not called"

**Verify webhook URL:**
- Must be HTTPS (Railway provides this)
- Must be publicly accessible
- Check Postmark webhook settings
- Look at **"Webhook Attempts"** for error messages

### "Email received but not appearing on plan page"

**Check processing:**
```bash
# Query database
psql $DATABASE_URL -c "SELECT * FROM sources ORDER BY created_at DESC LIMIT 5;"

# Should show the email source
```

**Check classification:**
```bash
psql $DATABASE_URL -c "SELECT * FROM items ORDER BY created_at DESC LIMIT 5;"

# Check detected_type and confidence
```

---

## Security: Verify Webhook Authenticity (Optional but Recommended)

Postmark doesn't send a signature by default, but you can verify requests come from their IP ranges.

**Postmark's webhook IPs:**
- Check: https://postmarkapp.com/support/article/800-ips-for-firewalls

Add middleware to check:

```javascript
const POSTMARK_IPS = [
  '50.31.156.6',
  '50.31.156.77',
  // ... add all IPs from Postmark docs
];

function verifyPostmarkWebhook(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  if (!POSTMARK_IPS.includes(ip)) {
    return res.status(403).send('Forbidden');
  }
  next();
}
```

For MVP, this is optional - Railway's URL is hard to guess anyway.

---

## Cost Breakdown

**Free Trial:**
- 100 emails (send + receive combined)
- All features included
- No credit card required

**Paid Plan:**
- $15/month
- 10,000 emails (send + receive combined)
- $1.25 per additional 1,000 emails

**For your MVP:**
- 2 pilot families × 5 emails/week × 2 weeks = ~20 emails
- Friday digest × 2 families × 2 weeks = 4 emails
- **Total: ~25 emails** (well within free trial)

---

## Next Steps After Setup

1. ✅ Domain verified in Postmark
2. ✅ MX records added and propagated
3. ✅ Webhook URL configured
4. ✅ Code updated to handle Postmark format
5. ✅ Environment variables updated
6. ✅ Test email successfully received and processed

**Then you're ready to:**
- Deploy to production
- Update Google OAuth callback
- Start pilot testing with real users!

---

## Quick Reference

### Postmark Dashboard URLs:
- Main: https://account.postmarkapp.com/
- Inbound Activity: [Your Server] → Inbound → Activity
- API Tokens: [Your Server] → API Tokens
- Webhook Settings: [Your Server] → Inbound → [Stream] → Webhook

### Important Endpoints:
- Webhook: `POST https://your-app/webhook/inbound-email`
- Test email: `anything@carebase.dev`

### Environment Variables:
```env
POSTMARK_SERVER_TOKEN=<from API Tokens tab>
INBOUND_EMAIL_DOMAIN=carebase.dev
```
