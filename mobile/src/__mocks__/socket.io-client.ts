export const io = jest.fn(() => ({
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
}));

export default { io };
