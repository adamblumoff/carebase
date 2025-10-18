import jwt from 'jsonwebtoken';
import type { User } from '@carebase/shared';

const LOGIN_TOKEN_TTL = '5m';
const ACCESS_TOKEN_TTL = '7d';

const MOBILE_AUTH_SECRET =
  process.env.MOBILE_AUTH_SECRET ??
  (process.env.NODE_ENV === 'test' ? 'test-mobile-secret' : undefined);

if (!MOBILE_AUTH_SECRET) {
  throw new Error('MOBILE_AUTH_SECRET must be configured');
}

export interface MobileTokenPayload {
  sub: number;
  email: string;
  type: 'login' | 'access';
}

function signToken(user: User, type: MobileTokenPayload['type'], expiresIn: string): string {
  const payload: MobileTokenPayload = {
    sub: user.id,
    email: user.email,
    type
  };

  return jwt.sign(payload, MOBILE_AUTH_SECRET, { expiresIn });
}

function verifyToken(token: string, expectedType: MobileTokenPayload['type']): MobileTokenPayload | null {
  try {
    const decoded = jwt.verify(token, MOBILE_AUTH_SECRET) as MobileTokenPayload;
    if (decoded.type !== expectedType) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function issueMobileLoginToken(user: User): string {
  return signToken(user, 'login', LOGIN_TOKEN_TTL);
}

export function verifyMobileLoginToken(token: string): MobileTokenPayload | null {
  return verifyToken(token, 'login');
}

export function issueMobileAccessToken(user: User): string {
  return signToken(user, 'access', ACCESS_TOKEN_TTL);
}

export function verifyMobileAccessToken(token: string): MobileTokenPayload | null {
  return verifyToken(token, 'access');
}
