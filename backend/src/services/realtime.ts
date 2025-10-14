import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { User } from '@carebase/shared';
import { verifyMobileAccessToken } from '../auth/mobileTokenService.js';
import { findUserById } from '../db/queries.js';

const userRoom = (userId: number) => `user:${userId}`;

export interface RealtimeEmitter {
  emitPlanUpdate(userId: number): void;
}

let emitter: RealtimeEmitter | null = null;

async function authenticateSocket(socket: Socket): Promise<User | null> {
  const req = socket.request as any;

  if (req.user && req.user.id) {
    return req.user as User;
  }

  const sessionUserId = req.session?.passport?.user;
  if (sessionUserId) {
    const user = await findUserById(sessionUserId);
    if (user) {
      return user;
    }
  }

  const token = socket.handshake.auth?.token || req.headers?.authorization?.split(' ')[1];
  if (!token) {
    return null;
  }

  const payload = verifyMobileAccessToken(token);
  if (!payload) {
    return null;
  }

  const user = await findUserById(payload.sub);
  return user ?? null;
}

export function initRealtime(io: SocketIOServer): void {
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

  emitter = {
    emitPlanUpdate(userId: number) {
      io.to(userRoom(userId)).emit('plan:update');
    }
  };
}

export function getRealtimeEmitter(): RealtimeEmitter | null {
  return emitter;
}
