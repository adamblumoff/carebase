# Deployment Guide

## Prerequisites

1. **Database**: PostgreSQL instance (Railway, Render, or local)
2. **Google OAuth**: OAuth 2.0 credentials from Google Cloud Console
3. **Resend**: API key for email service
4. **Google Cloud Vision** (optional): For OCR functionality

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Server
PORT=3000
NODE_ENV=production
SESSION_SECRET=<generate-random-secret>

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Google OAuth
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_CALLBACK_URL=https://yourdomain.com/auth/google/callback

# Email (Resend)
RESEND_API_KEY=<your-resend-api-key>
INBOUND_EMAIL_DOMAIN=yourdomain.com

# Google Cloud Vision (optional)
GOOGLE_CLOUD_PROJECT_ID=<your-project-id>
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# App
BASE_URL=https://yourdomain.com
```

## Deployment Steps

### 1. Railway (Recommended for MVP)

Railway provides both PostgreSQL and app hosting in one platform.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create new project
railway init

# Add PostgreSQL
railway add

# Deploy
railway up

# Set environment variables
railway variables set SESSION_SECRET=<random-secret>
railway variables set GOOGLE_CLIENT_ID=<client-id>
# ... etc
```

### 2. Manual Deployment (VPS, Render, etc.)

```bash
# Install dependencies
npm install

# Run migrations
npm run db:migrate

# Start production server
npm start
```

## Setting up Services

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `https://yourdomain.com/auth/google/callback`
5. Copy Client ID and Client Secret to `.env`

### Resend Email

1. Sign up at [Resend](https://resend.com)
2. Add and verify your domain
3. Create API key and add to `.env`
4. Configure inbound webhook:
   - Webhook URL: `https://yourdomain.com/webhook/inbound-email`
   - Configure routing rules for your forwarding addresses

### Google Cloud Vision (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable Vision API
3. Create service account
4. Download JSON key file
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to key file path

## Post-Deployment

1. **Test authentication**: Visit your site and try signing in with Google
2. **Test email forwarding**: Send a test email to your forwarding address
3. **Test photo upload**: Upload a sample bill photo
4. **Verify digest**: Wait for Friday or manually trigger with:
   ```javascript
   import { runDigestNow } from './src/jobs/digest.js';
   runDigestNow();
   ```

## Monitoring

- Check application logs for errors
- Monitor database connection
- Track email delivery via Resend dashboard
- Review audit logs for low confidence items

## Scaling Notes

For the pilot with 2 families:
- Single server instance is sufficient
- Basic PostgreSQL plan (1GB RAM)
- Resend free tier handles volume
- No CDN or caching needed yet

For production launch:
- Add Redis for session storage
- Implement rate limiting
- Add monitoring (Sentry, LogRocket)
- Consider dedicated email queue
