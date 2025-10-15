import express, { Request, Response } from 'express';

const router = express.Router();

router.get('/accept', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  res.render('collaborator-accept', {
    token,
    user: req.user ?? null,
  });
});

export default router;
