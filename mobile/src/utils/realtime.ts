import type { Socket } from 'socket.io-client';
import { io as createSocket } from 'socket.io-client';
import { API_BASE_URL } from '../config';
import { emitPlanChanged } from './planEvents';
import { fetchClerkSessionToken } from '../auth/clerkTokenCache';
import type { PlanItemDelta } from '@carebase/shared';
import { PLAN_ITEM_DELTA_EVENT } from '@carebase/shared';

let socket: Socket | null = null;
let connecting = false;
let connected = false;
const statusListeners = new Set<(status: 'connected' | 'disconnected') => void>();
const deltaListeners = new Set<(delta: PlanItemDelta) => void>();

function notifyStatus(status: 'connected' | 'disconnected') {
  statusListeners.forEach((listener) => {
    try {
      listener(status);
    } catch (error) {
      console.warn('[Realtime] Status listener error', error);
    }
  });
}

async function getAuthToken(): Promise<string | null> {
  try {
    return await fetchClerkSessionToken();
  } catch (error) {
    console.warn('[Realtime] Failed to resolve Clerk session token', error);
    return null;
  }
}

async function initSocket(): Promise<void> {
  if (socket || connecting) {
    return;
  }

  connecting = true;

  const token = await getAuthToken();
  socket = createSocket(API_BASE_URL, {
    transports: ['websocket'],
    forceNew: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    withCredentials: true,
    auth: token ? { token } : undefined
  });

  socket.on('connect', () => {
    connected = true;
    console.log('[Realtime] Connected');
    notifyStatus('connected');
  });

  socket.on('disconnect', (reason) => {
    connected = false;
    console.log('[Realtime] Disconnected', reason);
    notifyStatus('disconnected');
  });

  socket.on('connect_error', (error) => {
    connected = false;
    console.warn('[Realtime] Connection error', error);
    notifyStatus('disconnected');
  });

  socket.on('plan:update', () => {
    emitPlanChanged();
  });

  socket.on(PLAN_ITEM_DELTA_EVENT, (payload: { deltas: PlanItemDelta[] }) => {
    if (!payload || !Array.isArray(payload.deltas)) {
      emitPlanChanged();
      return;
    }

    payload.deltas.forEach((delta) => {
      deltaListeners.forEach((listener) => {
        try {
          listener(delta);
        } catch (error) {
          console.warn('[Realtime] Delta listener error', error);
        }
      });
    });
  });

  connecting = false;
}

export async function ensureRealtimeConnected(): Promise<void> {
  await initSocket();
}

export function isRealtimeConnected(): boolean {
  return connected;
}

export function addRealtimeStatusListener(listener: (status: 'connected' | 'disconnected') => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function addPlanDeltaListener(listener: (delta: PlanItemDelta) => void): () => void {
  deltaListeners.add(listener);
  return () => {
    deltaListeners.delete(listener);
  };
}
