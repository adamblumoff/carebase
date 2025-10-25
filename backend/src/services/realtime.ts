import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { User, PlanItemDelta } from '@carebase/shared';
import { findUserByClerkUserId } from '../db/queries.js';
import { verifyClerkSessionToken } from './clerkAuthGateway.js';
import { incrementMetric } from '../utils/metrics.js';
import { PlanRealtimePublisher } from './planRealtimePublisher.js';
import {
  setRealtimeEmitter
} from '../realtime/emitter.js';

export { getRealtimeEmitter, __setRealtimeEmitterForTests } from '../realtime/emitter.js';
import type { RealtimeEmitter } from '../realtime/emitter.js';

const userRoom = (userId: number) => `user:${userId}`;

async function authenticateSocket(socket: Socket): Promise<User | null> {
  const req = socket.request as any;

  if (req.user && req.user.id) {
    return req.user as User;
  }

  const authHeader: string | undefined = req.headers?.authorization;
  let bearerToken: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  const token = socket.handshake.auth?.token || bearerToken;
  if (!token) {
    return null;
  }

  const clerkVerification = await verifyClerkSessionToken(token);
  if (clerkVerification) {
    const user = await findUserByClerkUserId(clerkVerification.userId);
    if (user) {
      incrementMetric('auth.clerk.socket', 1, { via: 'clerk-session' });
      return user;
    }
  }

  return null;
}

export function initRealtime(io: SocketIOServer): void {
  const publisher = new PlanRealtimePublisher(io);

  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocket(socket);
      if (!user) {
        return next(new Error('Unauthorized'));
      }
      (socket.data as { user: User }).user = user;
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user: User = socket.data.user;
    socket.join(userRoom(user.id));
    socket.emit('connection:ack', { ok: true });

    socket.on('disconnect', () => {
      socket.leave(userRoom(user.id));
    });
  });

  const emitter: RealtimeEmitter = {
    emitPlanItemDelta(userId: number, delta: PlanItemDelta) {
      publisher.emitPlanItemDelta(userId, delta);
    }
  };
  setRealtimeEmitter(emitter);
}
