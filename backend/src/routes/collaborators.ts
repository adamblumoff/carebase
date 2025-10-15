import express, { Request, Response } from 'express';

const router = express.Router();

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

router.get('/accept', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const rawAppOpenUrl = process.env.COLLABORATOR_APP_OPEN_URL || '';
  const appDownloadUrl = process.env.COLLABORATOR_APP_DOWNLOAD_URL || '';
  const appOpenUrl = token ? formatAppLink(rawAppOpenUrl, token) : rawAppOpenUrl;
  res.render('collaborator-accept', {
    token,
    user: req.user ?? null,
    appOpenUrl,
    appDownloadUrl,
  });
});

export default router;
