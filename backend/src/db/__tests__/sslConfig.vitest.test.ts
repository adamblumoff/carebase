import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(async () => {
  resetEnv();
  await vi.resetModules();
});

describe('resolveSslConfig', () => {
  it('returns false when TLS is disabled explicitly', async () => {
    process.env.DATABASE_SSL = 'off';

    const mod = await import('../sslConfig.js');
    expect(mod.resolveSslConfig()).toBe(false);
  });

  it('decodes base64-encoded CA bundle for verify mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL = 'require';
    process.env.DATABASE_SSL_CA_BASE64 = Buffer.from('CERTIFICATE DATA').toString('base64');

    const mod = await import('../sslConfig.js');
    expect(mod.resolveSslConfig()).toEqual({
      ca: 'CERTIFICATE DATA',
      rejectUnauthorized: true
    });
  });

  it('throws when verification is enabled without CA in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL = 'off'; // allow module import without throwing
    const mod = await import('../sslConfig.js');

    process.env.DATABASE_SSL = 'require';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'true';

    expect(() => mod.resolveSslConfig()).toThrow(/DATABASE_SSL_CA/);
  });
});
