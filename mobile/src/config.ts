/**
 * Temporary compatibility shim.
 * Prefer importing from `./config/env`, `./config/apiEndpoints`, or `./config/oauth`.
 */

export {
  API_BASE_URL,
  CLERK_PUBLISHABLE_KEY,
  CLERK_SIGN_IN_URL,
  CLERK_SIGN_UP_URL,
  CLERK_JWT_TEMPLATE,
  DEFAULT_DEV_URL,
  DEFAULT_PROD_URL,
  readEnv
} from './config/env';

export { GOOGLE_CLIENT_ID } from './config/oauth';
export { API_ENDPOINTS } from './config/apiEndpoints';
