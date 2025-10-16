import express, { Request, Response } from 'express';

const router = express.Router();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAppLink(template: string, token: string): string {
  if (!template) return '';
  if (!token) return template;
  if (template.includes('{token}')) {
    return template.replace('{token}', encodeURIComponent(token));
  }
  const hasQuery = template.includes('?');
  const endsWithQuery = template.endsWith('?') || template.endsWith('&');
  const separator = endsWithQuery ? '' : hasQuery ? '&' : '?';
  return `${template}${separator}token=${encodeURIComponent(token)}`;
}

function renderAcceptPage(params: { token: string; appOpenUrl: string; appDownloadUrl: string }): string {
  const { token, appOpenUrl, appDownloadUrl } = params;
  const hasDeepLink = Boolean(appOpenUrl);
  const safeToken = token ? escapeHtml(token) : '';
  const safeAppOpenUrl = appOpenUrl ? escapeHtml(appOpenUrl) : '';
  const safeAppDownloadUrl = appDownloadUrl ? escapeHtml(appDownloadUrl) : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Carebase Collaborator Invite</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; color: #1f2933; margin: 0; padding: 40px 16px; }
      .card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12); padding: 32px; }
      h1 { margin-top: 0; font-size: 1.75rem; }
      p { line-height: 1.6; }
      .actions { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }
      a.button { display: inline-block; text-decoration: none; padding: 12px 16px; border-radius: 10px; font-weight: 600; text-align: center; }
      .primary { background: #2563eb; color: white; }
      .secondary { border: 1px solid #cbd5f5; color: #1d4ed8; }
      .token { margin-top: 16px; font-size: 0.85rem; background: #f1f5f9; padding: 12px; border-radius: 8px; word-break: break-all; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>You're almost in</h1>
      <p>To accept this invitation, open the Carebase app. If the app doesn't open automatically, you can copy the invite token below and paste it into the "Accept invite" screen.</p>
      <div class="actions">
        ${hasDeepLink ? `<a class="button primary" href="${safeAppOpenUrl}">Open Carebase App</a>` : ''}
        ${appDownloadUrl ? `<a class="button secondary" href="${safeAppDownloadUrl}">Get the Carebase App</a>` : ''}
      </div>
      ${token ? `<div class="token"><strong>Invite token:</strong><br/>${safeToken}</div>` : ''}
    </main>
  </body>
</html>`;
}

router.get('/accept', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const rawAppOpenUrl = process.env.COLLABORATOR_APP_OPEN_URL || '';
  const appDownloadUrl = process.env.COLLABORATOR_APP_DOWNLOAD_URL || '';
  const appOpenUrl = token ? formatAppLink(rawAppOpenUrl, token) : rawAppOpenUrl;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    renderAcceptPage({
      token,
      appOpenUrl,
      appDownloadUrl
    })
  );
});

export default router;
