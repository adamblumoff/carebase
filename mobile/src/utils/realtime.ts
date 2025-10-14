import type { Socket } from 'socket.io-client';
import { io as createSocket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config';
import { emitPlanChanged } from './planEvents';

let socket: Socket | null = null;
let connecting = false;
let connected = false;

async function getAuthToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem('accessToken');
  } catch (error) {
    console.warn('[Realtime] Failed to load access token', error);
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
  });

  socket.on('disconnect', (reason) => {
    connected = false;
    console.log('[Realtime] Disconnected', reason);
  });

  socket.on('connect_error', (error) => {
    connected = false;
    console.warn('[Realtime] Connection error', error);
  });

  socket.on('plan:update', () => {
    emitPlanChanged();
  });

  connecting = false;
}

export async function ensureRealtimeConnected(): Promise<void> {
  await initSocket();
}

export function isRealtimeConnected(): boolean {
  return connected;
}
