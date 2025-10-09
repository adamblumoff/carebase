# Setup Guide - Step by Step

This guide walks you through setting up all external services for Inbox to Week MVP.

## Step 1: PostgreSQL Database (Railway)

Railway provides free PostgreSQL hosting perfect for the MVP.

### Instructions:

1. **Sign up for Railway**
   - Go to https://railway.app/
   - Sign up with GitHub (recommended)

2. **Create a new project**
   - Click "New Project"
   - Select "Provision PostgreSQL"
   - Railway will automatically create a database

3. **Get connection string**
   - Click on your PostgreSQL service
   - Go to "Connect" tab
   - Copy the "Postgres Connection URL"
   - It looks like: `postgresql://postgres:password@host.railway.app:5432/railway`

4. **Save for later**
   - Keep this connection string - you'll add it to `.env` later

**✓ Done!** Your database is ready.

---

## Step 2: Google OAuth Setup

You need OAuth credentials to allow users to sign in with Google.

### Instructions:

1. **Go to Google Cloud Console**
   - Visit https://console.cloud.google.com/

2. **Create a new project** (or use existing)
   - Click the project dropdown at the top
   - Click "New Project"
   - Name it "Inbox to Week MVP"
   - Click "Create"

3. **Enable Google+ API**
   - In the left sidebar, go to "APIs & Services" > "Library"
   - Search for "Google+ API"
   - Click it and press "Enable"

4. **Configure OAuth consent screen**
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" (unless you have a Google Workspace)
   - Fill in:
     - App name: "Inbox to Week"
     - User support email: Your email
     - Developer contact: Your email
   - Click "Save and Continue"
   - Skip "Scopes" (click "Save and Continue")
   - Skip "Test users" for now (click "Save and Continue")

5. **Create OAuth credentials**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Application type: "Web application"
   - Name: "Inbox to Week Web Client"
   - Authorized JavaScript origins:
     - `http://localhost:3000` (for local testing)
   - Authorized redirect URIs:
     - `http://localhost:3000/auth/google/callback` (for local)
     - Add production URL later: `https://yourdomain.com/auth/google/callback`
   - Click "Create"

6. **Save credentials**
   - Copy the "Client ID" (looks like: `123456789-abc.apps.googleusercontent.com`)
   - Copy the "Client Secret" (looks like: `GOCSPX-abc123`)
   - Keep these for the `.env` file

**✓ Done!** You can now authenticate users with Google.

---

## Step 3: Resend Email Service

Resend handles both sending digest emails and receiving forwarded emails.

### Instructions:

1. **Sign up for Resend**
   - Go to https://resend.com/
   - Sign up with email or GitHub
   - Free tier: 100 emails/day (enough for pilot)

2. **Add your domain** (or use Resend's test domain for now)

   **Option A: Use test domain (quickest for testing)**
   - Skip domain setup for now
   - You can send emails from `onboarding@resend.dev`
   - But you won't get inbound email yet

   **Option B: Add your own domain (recommended for pilot)**
   - Click "Domains" in sidebar
   - Click "Add Domain"
   - Enter your domain (e.g., `yourdomain.com`)
   - Follow DNS instructions to add these records:
     - SPF record (TXT)
     - DKIM record (TXT)
     - MX records (for inbound email)
   - Wait for verification (usually 5-10 minutes)

3. **Create API Key**
   - Click "API Keys" in sidebar
   - Click "Create API Key"
   - Name it "Inbox to Week MVP"
   - Copy the key (starts with `re_`)
   - **Important**: Save this now - you can't see it again!

4. **Configure inbound email** (after domain is verified)
   - Click "Inbound" in sidebar
   - Click "Add Inbound Route"
   - Match: `*@yourdomain.com` (or specific pattern)
   - Forward to: We'll set this up after deploying
   - For now, skip this - we'll configure the webhook URL later

**✓ Done!** Email service is ready.

---

## Step 4: Configure Environment Variables

Now let's put all the credentials together.

### Instructions:

1. **Create .env file**
   ```bash
   cp .env.example .env
   ```

2. **Edit .env with your credentials**
   ```bash
   # Server
   PORT=3000
   NODE_ENV=development
   SESSION_SECRET=YOUR_RANDOM_SECRET_HERE  # Generate with: openssl rand -hex 32

   # Database (from Railway Step 1)
   DATABASE_URL=postgresql://postgres:password@host.railway.app:5432/railway

   # Google OAuth (from Google Cloud Step 2)
   GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-abc123
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

   # Email (from Resend Step 3)
   RESEND_API_KEY=re_your_api_key_here
   INBOUND_EMAIL_DOMAIN=yourdomain.com  # Or resend.dev for testing

   # Google Cloud Vision (optional - skip for now)
   # GOOGLE_CLOUD_PROJECT_ID=your-project-id
   # GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

   # App
   BASE_URL=http://localhost:3000
   ```

3. **Generate session secret**
   ```bash
   openssl rand -hex 32
   ```
   Copy the output and paste as `SESSION_SECRET`

**✓ Done!** Environment is configured.

---

## Step 5: Install Dependencies and Migrate Database

### Instructions:

1. **Install npm packages**
   ```bash
   npm install
   ```

2. **Run database migrations**
   ```bash
   npm run db:migrate
   ```

   You should see:
   ```
   Running database migrations...
   ✓ Database migrations completed successfully
   ```

**✓ Done!** Database schema is created.

---

## Step 6: Start the Application

### Instructions:

1. **Start development server**
   ```bash
   npm run dev
   ```

2. **Test authentication**
   - Open http://localhost:3000
   - Click "Sign in with Google"
   - Authorize the app
   - You should see your email and "View Plan" button

3. **Check what was created**
   - A user record with your email
   - A default recipient "My Care Recipient"
   - A unique forwarding email address (visible in Settings)

**✓ Done!** Application is running!

---

## Step 7: Test Core Features

### Test Email Parsing (Manual)

Since we don't have inbound email webhook set up yet, let's test the parser directly:

1. **Create a test source manually**
   ```bash
   node -e "
   import('./src/db/queries.js').then(async (db) => {
     // Get your recipient ID from the database
     const recipients = await db.findRecipientsByUserId(1);
     const recipientId = recipients[0].id;

     // Create a test appointment email
     const source = await db.createSource(recipientId, 'email', {
       sender: 'clinic@test.com',
       subject: 'Appointment Reminder',
       shortExcerpt: 'Your appointment is on December 15, 2024 at 2:30 PM with Dr. Smith at 123 Medical Drive.',
       storageKey: null
     });

     console.log('Created test source:', source.id);
   });
   "
   ```

2. **Process it through the parser**
   - The webhook would normally do this
   - For now, we can test manually or wait for webhook setup

### Test Photo Upload

1. Go to http://localhost:3000/settings
2. Find "Upload Bill Photo" section
3. Upload a photo of a bill (any image for now)
4. Without real OCR setup, it will use mock data
5. Check http://localhost:3000/plan to see if it appears

---

## Next Steps

### For Local Testing Only
You're done! You can:
- Sign in/out
- View the plan page
- Upload photos (with mock OCR)
- Test the Friday digest manually

### For Pilot with Real Users

You need to:
1. **Deploy to production** (Railway/Render/Vercel)
2. **Update Google OAuth** with production callback URL
3. **Configure Resend webhook** to point to your production URL
4. **Optional: Set up Google Cloud Vision** for real OCR
5. **Add test users** and start the pilot!

See `DEPLOYMENT.md` for production deployment steps.

---

## Troubleshooting

**"Cannot connect to database"**
- Check DATABASE_URL is correct
- Ensure Railway database is running
- Test connection: `psql $DATABASE_URL`

**"OAuth error" when signing in**
- Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
- Verify redirect URI matches in Google Console
- Make sure Google+ API is enabled

**"Email not sending"**
- Check RESEND_API_KEY is valid
- Verify domain is verified in Resend dashboard
- Check Resend logs for errors

**"Port already in use"**
- Change PORT in .env
- Or kill existing process: `lsof -ti:3000 | xargs kill`
