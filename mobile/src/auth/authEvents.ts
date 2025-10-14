const listeners = new Set<() => void>();

export const authEvents = {
  emitUnauthorized: () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.warn('auth unauthorized listener failed', error);
      }
    });
  },
  onUnauthorized: (handler: () => void) => {
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  },
};
