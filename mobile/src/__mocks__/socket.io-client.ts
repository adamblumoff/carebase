import { vi } from 'vitest';

export const io = vi.fn(() => ({
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
}));

export default { io };
