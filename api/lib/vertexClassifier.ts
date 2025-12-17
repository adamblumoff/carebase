import { GoogleAuth } from 'google-auth-library';

type ClassificationLabel = 'appointments' | 'bills' | 'medications' | 'needs_review' | 'ignore';

type ClassificationInput = {
  subject: string;
  snippet: string;
  body?: string | null;
  sender?: string | null;
  labelIds?: string[] | null;
  headers?: Record<string, string | undefined> | null;
};

export type ClassificationResult =
  | {
      label: ClassificationLabel;
      confidence: number;
      reason?: string;
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
    process.env.GOOGLE_VERTEX_PROJECT_ID ||
    process.env.GOOGLE_PUBSUB_PROJECT ||
    process.env.GCLOUD_PROJECT;
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

  const responseSchema = {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        enum: ['appointments', 'bills', 'medications', 'needs_review', 'ignore'],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reason: { type: 'string' },
    },
    required: ['label', 'confidence', 'reason'],
    additionalProperties: false,
  };

  const headerLines = Object.entries(input.headers ?? {})
    .filter(([, v]) => Boolean(v))
    .slice(0, 20)
    .map(([k, v]) => `${k}: ${truncate(String(v), 300)}`)
    .join('\n');

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              'You are an email-to-task filter for a caregiver app.',
              'Goal: only create tasks for actionable care items. Everything else should be ignore or needs_review.',
              'Important: keywords like "appointment", "bill", "medication" often appear in marketing. Do NOT treat keywords alone as actionable.',
              'Prefer ignore when the email is clearly promotional/bulk (unsubscribe/list headers) AND lacks concrete evidence.',
              '',
              'Actionable examples (create task):',
              '- Appointment confirmations or changes (often has date/time, location, calendar invite/ICS, provider name).',
              '- Bills/invoices that require payment or follow-up (often has amount due, due date, statement period, account/invoice number).',
              '- Medication prescriptions/refills (often has medication name, dosage, pharmacy, refill due date, prescribing provider).',
              '',
              'Non-actionable examples (ignore):',
              '- Newsletters, promotions, marketing, coupons, “refill your cart”, “appointment specials”.',
              '- Social notifications, forum digests, product updates.',
              '- Shipping updates and receipts that do not require action.',
              '',
              'If uncertain, choose needs_review with lower confidence.',
              'If there are bulk signals (List-Unsubscribe/List-Id/Precedence: bulk/list) and no concrete evidence (date/time, amount due, due date, Rx details), choose ignore with higher confidence.',
              'Return ONLY JSON matching this schema: {"label": "...", "confidence": 0.0-1.0, "reason": "..."}',
              `Subject: ${truncate(input.subject, 500)}`,
              `From: ${truncate(input.sender ?? '', 200)}`,
              `Gmail labels: ${(input.labelIds ?? []).slice(0, 20).join(', ')}`,
              headerLines ? `Headers:\n${headerLines}` : 'Headers: (none)',
              `Snippet: ${truncate(input.snippet, 700)}`,
              `Body: ${truncate(input.body ?? '', 3500)}`,
            ].join('\n'),
          },
        ],
      },
    ],
    // Vertex GenerateContent rejects duplicate oneof fields; use the camelCase shape only.
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 128,
      responseMimeType: 'application/json',
      responseSchema,
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
    const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;

    if (!label) {
      return { error: new Error('Vertex returned unknown label') };
    }

    return {
      label,
      confidence,
      reason,
      projectId,
      rawText: text,
    };
  } catch (error: any) {
    return { error, projectId };
  }
};
