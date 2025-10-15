import express, { Request, Response } from 'express';

const router = express.Router();

router.get('/accept', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const appOpenUrl = process.env.COLLABORATOR_APP_OPEN_URL || '';
  const appDownloadUrl = process.env.COLLABORATOR_APP_DOWNLOAD_URL || '';
  res.render('collaborator-accept', {
    token,
    user: req.user ?? null,
    appOpenUrl,
    appDownloadUrl,
  });
});

export default router;
