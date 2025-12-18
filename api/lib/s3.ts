import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const getS3Config = () => {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET is required');
  }

  return {
    bucket,
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  };
};

let cachedClient: S3Client | null = null;
const getClient = () => {
  if (cachedClient) return cachedClient;
  const { region, endpoint, forcePathStyle } = getS3Config();
  cachedClient = new S3Client({
    region,
    endpoint,
    forcePathStyle,
  });
  return cachedClient;
};

export const createStorageKey = ({
  careRecipientId,
  fileName,
}: {
  careRecipientId: string;
  fileName: string;
}) => {
  const ext = fileName.includes('.') ? fileName.split('.').pop() : null;
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const base = `${careRecipientId}/${year}/${month}/${day}`;
  const safeExt = ext ? ext.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : '';
  const suffix = safeExt ? `.${safeExt}` : '';
  return `${base}/${randomUUID()}${suffix}`;
};

export const getSignedUploadUrl = async ({
  key,
  contentType,
  expiresInSeconds = 600,
}: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}) => {
  const { bucket } = getS3Config();
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return { url };
};

export const uploadBuffer = async ({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Buffer;
  contentType: string;
}) => {
  const { bucket } = getS3Config();
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
};

export const getSignedDownloadUrl = async ({
  key,
  expiresInSeconds = 900,
}: {
  key: string;
  expiresInSeconds?: number;
}) => {
  const { bucket } = getS3Config();
  const client = getClient();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return { url };
};

export const deleteObject = async ({ key }: { key: string }) => {
  const { bucket } = getS3Config();
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};

const streamToBuffer = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export const getObjectBuffer = async ({ key }: { key: string }) => {
  const { bucket } = getS3Config();
  const client = getClient();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = response.Body;
  if (!body) return null;
  if (body instanceof Readable) {
    return streamToBuffer(body);
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  return null;
};
