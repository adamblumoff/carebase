import { Router } from 'express';
import {
  getGoogleIntegrationStatusHandler,
  connectGoogleIntegrationHandler,
  disconnectGoogleIntegrationHandler,
  manualGoogleSyncHandler,
  startGoogleIntegrationHandler,
  googleIntegrationCallbackHandler,
  googleIntegrationWebhookHandler
} from '../../../controllers/api/integrations/google.js';

const router = Router();

router.post('/connect/start', startGoogleIntegrationHandler);
router.get('/status', getGoogleIntegrationStatusHandler);
router.post('/connect', connectGoogleIntegrationHandler);
router.delete('/connect', disconnectGoogleIntegrationHandler);
router.post('/sync', manualGoogleSyncHandler);
router.get('/callback', googleIntegrationCallbackHandler);
router.post('/webhook', googleIntegrationWebhookHandler);

export default router;
