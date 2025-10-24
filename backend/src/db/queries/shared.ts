import crypto from 'crypto';
import db from '../client.js';
import { getRealtimeEmitter } from '../../realtime/emitter.js';

export { db, getRealtimeEmitter };

export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function generateForwardingAddress(userId: number): string {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return `user-${userId}-${randomPart}@${process.env.INBOUND_EMAIL_DOMAIN}`;
}
