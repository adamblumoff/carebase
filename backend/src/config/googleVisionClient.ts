import vision from '@google-cloud/vision';

const INLINE_JSON_ENV = 'OCR_SERVICE_ACCOUNT_JSON';

type VisionClientOptions = ConstructorParameters<typeof vision.ImageAnnotatorClient>[0];

interface ParsedCredentials {
  credentials: {
    client_email: string;
    private_key: string;
  };
  projectId?: string;
}

function decodeInlineJson(raw: string): ParsedCredentials {
  const trimmed = raw.trim();
  let jsonSource = trimmed;

  if (!trimmed.startsWith('{')) {
    try {
      jsonSource = Buffer.from(trimmed, 'base64').toString('utf8');
    } catch (error) {
      throw new Error(`Failed to base64 decode ${INLINE_JSON_ENV}: ${(error as Error).message}`);
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonSource);
  } catch (error) {
    throw new Error(`Failed to parse ${INLINE_JSON_ENV} as JSON: ${(error as Error).message}`);
  }

  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : undefined;
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : undefined;
  const projectId = typeof parsed.project_id === 'string' ? parsed.project_id : undefined;

  if (!clientEmail || !privateKey) {
    throw new Error(`${INLINE_JSON_ENV} is missing client_email/private_key`);
  }

  return {
    credentials: {
      client_email: clientEmail,
      private_key: privateKey
    },
    projectId
  };
}

function buildVisionClientOptions(): VisionClientOptions | undefined {
  const inline = process.env[INLINE_JSON_ENV];
  if (inline) {
    const { credentials, projectId } = decodeInlineJson(inline);
    return {
      credentials,
      projectId
    };
  }

  const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFilename) {
    return { keyFilename };
  }

  return undefined;
}

export function createVisionClient(): vision.ImageAnnotatorClient {
  const options = buildVisionClientOptions();
  return options ? new vision.ImageAnnotatorClient(options) : new vision.ImageAnnotatorClient();
}
