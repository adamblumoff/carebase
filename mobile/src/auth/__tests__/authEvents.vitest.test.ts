import { describe, expect, it, vi } from 'vitest';
import { authEvents } from '../authEvents';

describe('authEvents', () => {
  it('registers and removes unauthorized handlers', () => {
    const listener = vi.fn();
    const unsubscribe = authEvents.onUnauthorized(listener);

    authEvents.emitUnauthorized();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    authEvents.emitUnauthorized();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('guards against listener errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authEvents.onUnauthorized(() => {
      throw new Error('listener failure');
    });

    authEvents.emitUnauthorized();

    expect(warnSpy).toHaveBeenCalledWith('auth unauthorized listener failed', expect.any(Error));
    warnSpy.mockRestore();
  });
});
