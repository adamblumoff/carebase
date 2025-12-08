import { GoogleAuth } from 'google-auth-library';

type ClassificationLabel = 'appointments' | 'bills' | 'medications' | 'needs_review' | 'ignore';

type ClassificationInput = {
  subject: string;
  snippet: string;
  body?: string | null;
};

export type ClassificationResult =
  | {
      label: ClassificationLabel;
      confidence: number;
      projectId?: string | null;
      rawText?: string;
    }
  | {
      error: Error;
      projectId?: string | null;
    };

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const getProjectId = async () => {
  const envProject =
    process.env.GOOGLE_VERTEX_PROJECT_ID || process.env.GOOGLE_PUBSUB_PROJECT || process.env.GCLOUD_PROJECT;
  if (envProject) return envProject;
  try {
    return await auth.getProjectId();
  } catch {
    return null;
  }
};

const LOCATION = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
const MODEL_ID = 'gemini-2.5-flash-lite';

const truncate = (value: string, max = 4000) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const normalizeLabel = (value?: string | null): ClassificationLabel | null => {
  if (!value) return null;
  const label = value.trim().toLowerCase();
  if (['appointment', 'appointments', 'appt', 'calendar'].includes(label)) return 'appointments';
  if (['bill', 'bills', 'invoice', 'statement', 'payment'].includes(label)) return 'bills';
  if (['medication', 'medications', 'rx', 'prescription'].includes(label)) return 'medications';
  if (['needs review', 'needs_review', 'review', 'manual'].includes(label)) return 'needs_review';
  if (['ignore', 'spam', 'junk', 'trash'].includes(label)) return 'ignore';
  return null;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const classifyEmailWithVertex = async (
  input: ClassificationInput
): Promise<ClassificationResult> => {
  const projectId = await getProjectId();
  if (!projectId) {
    return { error: new Error('Vertex project id missing (set GOOGLE_VERTEX_PROJECT_ID)') };
  }

  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'Classify this email into one of: appointments, bills, medications, needs_review, ignore.',
              'Return JSON: {"label": "<one_of_labels>", "confidence": 0.0-1.0, "reason": "..."}',
              `Subject: ${truncate(input.subject, 500)}`,
              `Snippet: ${truncate(input.snippet, 500)}`,
              `Body: ${truncate(input.body ?? '', 3500)}`,
            ].join('\n'),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 128,
      response_mime_type: 'application/json',
    },
  };

  try {
    const client = await auth.getClient();
    const response = await client.request<{ candidates?: any[] }>({
      url,
      method: 'POST',
      data: body,
    });

    const text =
      response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
      response.data.candidates?.[0]?.output_text ||
      null;

    if (!text) {
      return { error: new Error('Vertex response missing text') };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { error: new Error('Vertex response not JSON: ' + String(err)) };
    }

    const label = normalizeLabel(parsed.label);
    const confidence = clamp01(Number(parsed.confidence ?? parsed.score ?? 0));

    if (!label) {
      return { error: new Error('Vertex returned unknown label') };
    }

    return {
      label,
      confidence,
      projectId,
      rawText: text,
    };
  } catch (error: any) {
    return { error, projectId };
  }
};
