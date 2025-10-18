import { afterEach, describe, expect, it, vi } from 'vitest';

const mockVisionClientInstance = {};
const mockImageAnnotatorClient = vi.fn(() => mockVisionClientInstance);

vi.mock('@google-cloud/vision', () => ({
  default: {
    ImageAnnotatorClient: mockImageAnnotatorClient
  },
  ImageAnnotatorClient: mockImageAnnotatorClient
}));

function resetEnv() {
  delete process.env.OCR_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

describe('createVisionClient', () => {
  afterEach(async () => {
    resetEnv();
    vi.clearAllMocks();
    // Ensure module under test re-evaluates env for each spec.
    await vi.resetModules();
  });

  it('constructs the client with inline JSON credentials from env', async () => {
    const credentials = {
      type: 'service_account',
      project_id: 'care-base',
      private_key_id: 'abc123',
      private_key: '-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----\n',
      client_email: 'ocr-bot@care-base.iam.gserviceaccount.com',
      client_id: '987654321',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token'
    };

    process.env.OCR_SERVICE_ACCOUNT_JSON = JSON.stringify(credentials);

    const { createVisionClient } = await import('../googleVisionClient.js');

    const client = createVisionClient();

    expect(client).toBe(mockVisionClientInstance);
    expect(mockImageAnnotatorClient).toHaveBeenCalledWith({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key
      },
      projectId: credentials.project_id
    });
  });

  it('constructs the client with key filename fallback when env JSON is absent', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/ocr-service-account.json';

    const { createVisionClient } = await import('../googleVisionClient.js');

    createVisionClient();

    expect(mockImageAnnotatorClient).toHaveBeenCalledWith({
      keyFilename: '/tmp/ocr-service-account.json'
    });
  });
});
