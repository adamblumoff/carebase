import { z } from 'zod';

export const googleConnectSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
  expiresAt: z.string().optional(),
  expiresIn: z.coerce.number().int().nonnegative().optional(),
  tokenType: z.string().optional(),
  idToken: z.string().optional(),
  calendarId: z.string().nullable().optional(),
  authorizationCode: z.string().optional(),
  codeVerifier: z.string().optional(),
  redirectUri: z.string().url().optional()
});

export const googleManualSyncSchema = z.object({
  forceFull: z.boolean().optional(),
  calendarId: z.string().optional(),
  pullRemote: z.boolean().optional()
});
