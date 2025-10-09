# Roadmap: Local Dev → Production Launch

This roadmap follows the MVP outline's pilot and launch gates.

---

## Current Status: ✅ Local Development Complete

You have:
- ✅ Full MVP built with all 6 required features
- ✅ Database on Railway
- ✅ Google OAuth configured
- ✅ Resend API connected
- ✅ Test data working locally
- ✅ All acceptance tests passing

---

## Phase 1: Domain Setup & Production Deployment (Days 1-2)

### Step 1.1: Domain Setup

**If you don't have a domain:**
- Buy a domain ($12-15/year)
  - Recommended: `.dev` domains (secure by default, good for tech)
  - Examples: `carebase.dev`, `inboxtoweek.dev`
  - Where to buy: Google Domains, Namecheap, Cloudflare

**Configure DNS in Resend:**
1. Add domain to Resend dashboard
2. Copy provided DNS records
3. Add to your domain registrar:
   ```
   MX Records (2):
   - 10 feedback-smtp.us-east-1.amazonses.com
   - 10 feedback-smtp.us-west-2.amazonses.com

   TXT Record (SPF):
   - v=spf1 include:amazonses.com ~all

   TXT Record (DKIM):
   - [Long key provided by Resend]
   ```
4. Wait for verification (5-30 minutes)

**Update environment:**
```bash
# In .env
INBOUND_EMAIL_DOMAIN=yournewdomain.com
BASE_URL=https://yournewdomain.com
```

### Step 1.2: Production Deployment

**Option A: Deploy on Railway (Recommended)**

Why: Already hosting your database there, keep it simple.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to existing project
railway link

# Deploy
railway up

# Set environment variables in Railway dashboard
# (Same as your local .env but with production values)
```

Railway will:
- ✅ Auto-detect Node.js
- ✅ Run `npm install`
- ✅ Provide a public URL (e.g., `your-app.up.railway.app`)
- ✅ Connect to your existing database
- ✅ Run `npm start` automatically

**Option B: Vercel/Render/Fly.io**
See `DEPLOYMENT.md` for other options.

### Step 1.3: Configure Resend Inbound Webhook

Once deployed:

1. Get your production URL: `https://your-app.up.railway.app`
2. In Resend dashboard → Inbound → Routes
3. Create inbound route:
   - **Match**: `*@yournewdomain.com` (all emails)
   - **Forward to**: `https://your-app.up.railway.app/webhook/inbound-email`
4. Save

### Step 1.4: Test Production

Send test email:
```bash
# From your Gmail, forward any email to:
user-1-[your-random-hex]@yournewdomain.com

# Check Resend dashboard → Inbound → Activity
# Should show: Email received → Webhook called → 200 OK

# Check your production app logs (Railway dashboard)
# Should show: "Created appointment/bill item"
```

**Success criteria:**
- ✅ Email received by Resend
- ✅ Webhook called successfully (200 response)
- ✅ Item appears on plan page
- ✅ No errors in logs

---

## Phase 2: Pilot Preparation (Days 3-4)

### Step 2.1: Create Seed Users

Create 2 internal test users (you + teammate/family member):

1. **User 1**: Sign in with your Google account
2. **User 2**: Sign in with second Google account
3. Note their forwarding addresses from Settings page

Test each:
- Forward 1 clinic appointment email
- Forward 1 billing email
- Upload 1 photo of a bill
- Verify all appear correctly on plan page
- Click "Add to Calendar" and import to real calendar
- Wait for Friday (or manually trigger digest)

### Step 2.2: Set Up Monitoring

**Error Tracking** (Optional but recommended):

```bash
npm install @sentry/node

# Add to src/server.js
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "your-sentry-dsn",
  environment: process.env.NODE_ENV
});
```

**Key Metrics to Track:**

Create a simple monitoring dashboard (spreadsheet for MVP):

| Metric | Formula | Target |
|--------|---------|--------|
| Auto-capture rate | Items with confidence > 0.7 / Total items | 60%+ |
| Manual review rate | Items with confidence < 0.7 / Total items | < 40% |
| Classification accuracy | Correctly classified / Total reviewed | 90%+ |
| Email processing time | Time from receive to DB insert | < 1 sec |

**Query for metrics:**

```sql
-- Auto-capture rate (weekly)
SELECT
  COUNT(*) FILTER (WHERE confidence >= 0.7) * 100.0 / COUNT(*) as capture_rate,
  COUNT(*) FILTER (WHERE confidence < 0.7) as needs_review
FROM items
WHERE created_at >= NOW() - INTERVAL '7 days';

-- Type breakdown
SELECT
  detected_type,
  COUNT(*),
  AVG(confidence)
FROM items
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY detected_type;
```

### Step 2.3: Create Low-Confidence Review Tool

Add a simple admin page to review flagged items:

```javascript
// src/routes/admin.js (new file)
import express from 'express';
import { getLowConfidenceItems } from '../db/queries.js';

const router = express.Router();

router.get('/review', async (req, res) => {
  const items = await getLowConfidenceItems(50);
  res.render('admin/review', { items });
});

export default router;
```

This lets you manually review and correct misclassifications.

### Step 2.4: Improve Parser Rules

Based on seed user testing, adjust parser in `src/services/parser.js`:

```javascript
// Add common healthcare provider domains
const TRUSTED_SENDERS = [
  '@healthcare.com',
  '@labcorp.com',
  '@questdiagnostics.com'
];

// Boost confidence for trusted senders
if (TRUSTED_SENDERS.some(domain => source.sender.includes(domain))) {
  confidence += 0.1;
}

// Add more date patterns you encounter
const DATE_PATTERNS = [
  ...existing,
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,  // MM/DD/YYYY
  /\b\d{4}-\d{2}-\d{2}\b/          // ISO dates
];
```

**Success criteria:**
- ✅ 2 seed users created and tested
- ✅ Each user forwarded 3+ test emails
- ✅ 80%+ classified correctly
- ✅ Monitoring queries working
- ✅ Friday digest delivered successfully

---

## Phase 3: Real Pilot (Weeks 1-2)

### Step 3.1: Recruit 2 Pilot Families

**Ideal pilot user:**
- Caring for someone with regular medical appointments
- Receives 2-5 healthcare emails per week
- Comfortable with basic tech (Gmail filters, forwarding)
- Willing to give feedback

**Recruitment:**
- Friends/family caring for elderly parents
- Local caregiver support groups
- Your own network

### Step 3.2: Onboard Pilot Users

**Onboarding checklist per family:**

1. **Sign up**
   - Send them your production URL
   - They sign in with Google
   - You verify user + recipient created

2. **Set up Gmail forwarding**
   - Walk them through creating filter (see EMAIL_PIPELINE.md)
   - Or: have them manually forward first few emails
   - Test: send them a test email to forward

3. **Show them around**
   - How to view plan page
   - How to add appointments to calendar
   - How to upload photo of bill
   - How to share plan with family (secret link)
   - How to mark bills as paid (future feature - for now just visual)

4. **Set expectations**
   - This is a pilot/test
   - Some emails might not parse perfectly
   - You'll be monitoring and fixing issues
   - They can text/email you with problems

### Step 3.3: Monitor Daily During Pilot

**Daily checklist:**

```bash
# Check low confidence items
psql $DATABASE_URL -c "
  SELECT i.id, s.sender, s.subject, i.confidence
  FROM items i
  JOIN sources s ON i.source_id = s.id
  WHERE i.confidence < 0.7
    AND i.created_at >= NOW() - INTERVAL '1 day'
  ORDER BY i.created_at DESC;
"

# Check for errors
# (In Railway dashboard, or your logs)

# Ask pilot users:
# - Did you forward any emails today?
# - Are they showing up correctly?
# - Any issues or confusion?
```

**Fix issues quickly:**
- Parser misclassifications → Update rules
- Missing data (location, amount) → Improve extraction
- User confusion → Improve UI/instructions

### Step 3.4: Collect Feedback

**After Week 1:**
- Quick call with each family (15 min)
- What's working?
- What's confusing?
- What's missing?

**Questions to ask:**
- Is the plan page reducing your coordination time?
- Are you checking it regularly?
- Is anything being missed or wrong?
- Would you share this with other family members?
- What would make this indispensable?

**After Week 2:**
- Same call
- More in-depth feedback
- Decision: continue or adjust?

---

## Phase 4: Measure Against Launch Gates (End of Week 2)

From your MVP outline, you need:

### Gate 1: Two families used product for 2 weeks ✓
Already done if pilot succeeded.

### Gate 2: 60%+ auto-capture rate

**Query:**
```sql
SELECT
  COUNT(*) FILTER (WHERE confidence >= 0.7 AND detected_type != 'noise') * 100.0 /
  COUNT(*) FILTER (WHERE detected_type != 'noise') as capture_rate
FROM items
WHERE created_at >= NOW() - INTERVAL '14 days';
```

**If below 60%:**
- Review low confidence items
- Add missing keywords to parser
- Improve date/time/money extraction
- Run pilot for 1 more week with improvements

### Gate 3: 90%+ bills paid by due date

**Query:**
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'paid' AND due_date IS NOT NULL) * 100.0 /
  COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < NOW()) as payment_rate
FROM bills
WHERE due_date >= NOW() - INTERVAL '14 days';
```

**Note:** This requires users to manually mark bills as paid. You might need to:
- Add a "Mark as Paid" button (quick feature)
- Or manually update based on user feedback

### Gate 4: Families confirm reduced coordination time ✓
Qualitative feedback from calls.

**Success looks like:**
- "I don't have to dig through emails anymore"
- "My sister can see the plan without me texting updates"
- "I didn't miss an appointment"
- "This saved me at least 2 hours this week"

---

## Phase 5: Launch Decision

### Scenario A: All Gates Passed ✓

**You're ready to launch!**

Next steps:
1. Clean up any remaining bugs
2. Write brief launch announcement
3. Expand to 5-10 more families
4. Consider pricing model
5. Start building next features (from "Post launch next inch")

### Scenario B: Some Gates Failed

**Don't launch yet. Options:**

**If auto-capture < 60%:**
- Extend pilot 1 week with improved parser
- Add more training data
- Consider basic ML model (simple classification)

**If payment rate < 90%:**
- Check: Is this a UI issue? (Add "Mark Paid" button)
- Or a reminder issue? (Send payment reminders)
- Or coordination issue? (Family not using it)

**If families not seeing value:**
- Deep dive: What's missing?
- Is it the right user segment?
- Do they need different features?
- Maybe pivot focus

### Scenario C: Technical Issues

**If errors/crashes:**
- Fix immediately
- Add more error handling
- Improve monitoring
- Extend pilot until stable

---

## Phase 6: Post-Launch (If Gates Passed)

From your MVP outline's "Post launch next inch":

### Feature 1: Medication Tracking
**Why:** Natural extension, high value

Implementation:
- Photo upload for pill bottles
- OCR extract: drug name, dosage, refill date
- New table: `medications`
- Show "Refill needed" warnings
- Estimated time: 3-4 days

### Feature 2: Portal Export Support
**Why:** Many healthcare portals let you export records

Implementation:
- Upload CSV/PDF from patient portal
- Parse common formats (Epic, Cerner, etc.)
- Extract appointments and bills
- Estimated time: 5-7 days

### Feature 3: Bank Connection (Read-only)
**Why:** Confirm bills actually paid

Implementation:
- Plaid integration (read-only transactions)
- Match bill amounts to transactions
- Auto-mark as paid when detected
- Privacy: Only check specific amounts, don't store full transaction history
- Estimated time: 5-7 days

**Priority order:**
1. Medication tracking (most requested, simplest)
2. Bank confirmation (highest impact on metrics)
3. Portal exports (complex, fewer users need it initially)

---

## Metrics to Track Weekly (Post-Launch)

From your MVP outline:

### 1. Auto Capture Hit Rate
```sql
-- Items auto-captured without manual review
SELECT
  DATE_TRUNC('week', created_at) as week,
  COUNT(*) FILTER (WHERE confidence >= 0.7) * 100.0 / COUNT(*) as capture_rate
FROM items
WHERE created_at >= NOW() - INTERVAL '4 weeks'
GROUP BY week
ORDER BY week DESC;
```

**Target:** Improve week over week, maintain > 60%

### 2. On-Time Bill Rate
```sql
-- Bills paid by due date
SELECT
  DATE_TRUNC('week', due_date) as week,
  COUNT(*) FILTER (WHERE status = 'paid' AND due_date >= statement_date) * 100.0 /
  COUNT(*) FILTER (WHERE due_date IS NOT NULL) as on_time_rate
FROM bills
WHERE due_date >= NOW() - INTERVAL '4 weeks'
GROUP BY week
ORDER BY week DESC;
```

**Target:** Maintain > 90%

### 3. Missed Visit Rate
```sql
-- Appointments in past week that weren't marked completed
SELECT
  COUNT(*) FILTER (WHERE start_local < NOW() AND status != 'completed') * 100.0 /
  COUNT(*) as missed_rate
FROM appointments
WHERE start_local >= NOW() - INTERVAL '7 days'
  AND start_local < NOW();
```

**Target:** < 5% (you'll need to add status tracking)

### 4. Weekly Active Rate
```sql
-- Users who viewed plan or opened digest in past week
SELECT
  COUNT(DISTINCT user_id) * 100.0 / (SELECT COUNT(*) FROM users) as active_rate
FROM (
  -- Plan page views (would need to add tracking)
  UNION
  -- Digest opens (would need tracking pixels or link clicks)
) activity
WHERE activity_date >= NOW() - INTERVAL '7 days';
```

**Target:** > 80% (very engaged user base)

### 5. Referral Share Rate
```sql
-- Plan share link clicks from settings page
-- (Need to add tracking when share button clicked)
```

**Target:** At least 1 share per 3 users

---

## Key Decision Points

### After Pilot Week 1:
**Decision:** Continue as-is, or pivot?
- If major issues: Fix and restart
- If minor issues: Continue and fix
- If no issues: Great, keep going

### After Pilot Week 2:
**Decision:** Launch or extend?
- All gates passed: Launch to 10 families
- 1-2 gates failed: Extend 1 week with fixes
- Multiple gates failed: Major pivot needed

### After Launch Month 1:
**Decision:** Grow or optimize?
- If retention > 80%: Focus on growth
- If retention < 50%: Focus on product improvements
- If mixed: Segment - what's working for whom?

---

## Risk Mitigation

### Technical Risks

**Risk:** Parser accuracy degrades with volume
**Mitigation:**
- Monitor confidence scores weekly
- Add more test cases as you see them
- Keep audit logs for training data

**Risk:** Email provider (Resend) issues
**Mitigation:**
- Have fallback: direct IMAP/SMTP if needed
- Diversify: Can switch to SendGrid/Mailgun quickly
- Monitor Resend status page

**Risk:** Database grows too large
**Mitigation:**
- Archive old items > 6 months
- Optimize queries with indexes
- Scale Railway plan if needed ($5/mo)

### Product Risks

**Risk:** Users don't adopt email forwarding
**Mitigation:**
- Provide step-by-step video tutorial
- Offer to set up for them via screen share
- Alternative: Direct IMAP access to Gmail (privacy concerns)

**Risk:** Families don't see value
**Mitigation:**
- Weekly check-ins during pilot
- Quick response to feedback
- Be willing to pivot features

**Risk:** Competitive pressure
**Mitigation:**
- Move fast on pilot (you're doing this!)
- Build relationships with pilot users
- Focus on simplicity as differentiator

---

## Timeline Summary

| Phase | Duration | Key Milestone |
|-------|----------|---------------|
| Domain Setup | 1 day | Domain verified, app deployed |
| Production Testing | 1 day | Real emails flowing through |
| Pilot Prep | 2 days | 2 seed users tested successfully |
| Pilot Execution | 2 weeks | 2 families using daily |
| Launch Decision | 1 day | Measure gates, decide |
| **Total to Launch** | **~3 weeks** | Ready for 10+ families |

---

## Success Definition

**You've succeeded when:**
- ✅ 2 families used for 2 weeks without major issues
- ✅ 60%+ of items auto-captured correctly
- ✅ 90%+ of bills paid on time
- ✅ Families report saving 2+ hours/week
- ✅ At least 1 family has shared with another family member
- ✅ You feel confident scaling to 10 more families

**Then you're ready for the next stage!**

---

## Questions to Answer During Pilot

### Week 1:
1. Is email forwarding too technical for users?
2. Are date/time extractions accurate?
3. Is the plan page layout intuitive?
4. Do users click "Add to Calendar"?
5. Are bill amounts extracted correctly?

### Week 2:
1. Do users still check the plan daily?
2. Has it prevented any missed appointments?
3. Are family members using the share link?
4. What features are they asking for?
5. Would they pay for this? How much?

---

## Next Steps RIGHT NOW

1. **Decide on domain** (buy one or use existing)
2. **Deploy to Railway** (15 minutes)
3. **Configure Resend webhook** (5 minutes)
4. **Send test email** (verify end-to-end)
5. **Create seed users** (test for 1 day)
6. **Find 2 pilot families** (start recruiting)

You're about 3 days away from having real users on this!
