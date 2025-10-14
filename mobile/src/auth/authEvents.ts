import { EventEmitter } from 'events';

const emitter = new EventEmitter();

export const AUTH_EVENTS = {
  UNAUTHORIZED: 'unauthorized',
};

export const authEvents = {
  emitUnauthorized: () => emitter.emit(AUTH_EVENTS.UNAUTHORIZED),
  onUnauthorized: (handler: () => void) => {
    emitter.on(AUTH_EVENTS.UNAUTHORIZED, handler);
    return () => {
      emitter.off(AUTH_EVENTS.UNAUTHORIZED, handler);
    };
  },
};

