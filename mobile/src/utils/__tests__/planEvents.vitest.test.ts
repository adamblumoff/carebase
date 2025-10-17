import { describe, expect, it, vi } from 'vitest';
import { addPlanChangeListener, emitPlanChanged } from '../planEvents';

describe('planEvents', () => {
  it('notifies listeners and removes when unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = addPlanChangeListener(listener);

    emitPlanChanged();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitPlanChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('guards against listener errors', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const faulty = vi.fn(() => {
      throw new Error('fail');
    });
    addPlanChangeListener(faulty);

    expect(() => emitPlanChanged()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
