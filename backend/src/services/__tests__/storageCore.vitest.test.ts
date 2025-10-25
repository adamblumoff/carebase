import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writeFile = vi.fn();
const readFile = vi.fn();
const mkdir = vi.fn();
const readdir = vi.fn();

vi.mock('fs/promises', () => ({
  writeFile,
  readFile,
  mkdir,
  readdir
}));

const deterministicHex = '1234567890abcdef1234567890abcdef';
const cryptoRandomBytes = vi.fn(() => Buffer.from(deterministicHex, 'hex'));
vi.mock('crypto', () => ({
  randomBytes: cryptoRandomBytes,
  default: {
    randomBytes: cryptoRandomBytes
  }
}));

const storage = await import('../storage.js');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('storage service', () => {
  it('stores text content and returns deterministic key', async () => {
    const key = await storage.storeText('hello world');

    expect(key).toBe(deterministicHex);
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('uploads'), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/uploads\/1234567890abcdef1234567890abcdef\.txt$/),
      'hello world',
      'utf8'
    );
  });

  it('sanitizes file extension when storing binary buffers', async () => {
    await storage.storeFile(Buffer.from('data'), 'pNg??');

    const firstCall = writeFile.mock.calls.at(-1);
    expect(firstCall?.[0]).toMatch(/uploads\/1234567890abcdef1234567890abcdef\.png$/);
    expect(firstCall?.[1]).toEqual(Buffer.from('data'));
  });

  it('rejects retrieval when storage key is unsafe', async () => {
    await expect(storage.retrieveText('../evil')).rejects.toThrow('Invalid storage key');
    await expect(storage.retrieveFile('..\\evil')).rejects.toThrow('Invalid storage key');
  });

  it('falls back to matching file with extension when direct read fails', async () => {
    readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    readdir.mockResolvedValueOnce(['1234567890abcdef1234567890abcdef.png']);
    readFile.mockResolvedValueOnce(Buffer.from('contents'));

    const buffer = await storage.retrieveFile('1234567890abcdef1234567890abcdef');

    expect(buffer.toString()).toBe('contents');
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
