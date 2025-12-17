import {
  decideTaskRouting,
  getHeader,
  hasBulkHeaderSignals,
  looksMarketing,
  shouldTombstoneNonActionableMessage,
  shouldTombstoneMessage,
  toHeaderMap,
  type ClassificationBucket,
  type HeaderPair,
  type ParsedDetailsLike,
} from './ingestionHeuristics';
import type { ClassificationResult } from './vertexClassifier';
import { decodeRfc2047HeaderValue } from './rfc2047';

export type MessageLike = {
  id?: string | null;
  labelIds?: string[] | null;
  sizeEstimate?: number | null;
  snippet?: string | null;
  payload?: {
    headers?: HeaderPair[] | null;
  } | null;
};

export type ClassifierInput = {
  subject: string;
  snippet: string;
  body?: string | null;
  sender?: string | null;
  labelIds?: string[] | null;
  headers?: Record<string, string | undefined> | null;
};

export type ClassifierFn = (input: ClassifierInput) => Promise<ClassificationResult>;

export type ParserFn = (args: {
  message: MessageLike;
  subject: string;
  sender?: string | null;
  snippet: string;
}) => ParsedDetailsLike;

export type PipelineAction =
  | 'skipped_ignored'
  | 'skipped_non_inbox'
  | 'skipped'
  | 'skipped_low_confidence'
  | 'tombstoned'
  | 'upsert';

export type PipelineResult =
  | {
      action: Exclude<PipelineAction, 'upsert'>;
      id: string;
      payload?: Record<string, any>;
      bucket?: ClassificationBucket;
      decision?: ReturnType<typeof decideTaskRouting>;
      classification?: ClassificationResult;
    }
  | {
      action: 'upsert';
      id: string;
      payload: Record<string, any>;
      bucket: ClassificationBucket;
      decision: ReturnType<typeof decideTaskRouting>;
      classification: ClassificationResult;
    };

const gmailMessageLink = (accountEmail: string, messageId: string) =>
  `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${messageId}`;

const asBucket = (classification: ClassificationResult): ClassificationBucket => {
  if ('error' in classification) return null;
  return classification.label;
};

const asConfidence = (classification: ClassificationResult): number | null => {
  if ('error' in classification) return null;
  return classification.confidence;
};

export const processGmailMessageToTask = async ({
  message,
  accountEmail,
  caregiverId,
  careRecipientId,
  ignoredExternalIds,
  suppressedSenderDomains,
  classify,
  parse,
  now = new Date(),
}: {
  message: MessageLike;
  accountEmail: string;
  caregiverId: string;
  careRecipientId: string;
  ignoredExternalIds: Set<string>;
  suppressedSenderDomains?: Set<string>;
  classify: ClassifierFn;
  parse: ParserFn;
  now?: Date;
}): Promise<PipelineResult> => {
  const messageId = message.id ?? 'unknown';

  const labels = message.labelIds ?? [];
  const isInbox = labels.includes('INBOX');
  const isDraft = labels.includes('DRAFT');
  if (!isInbox || isDraft) {
    return { action: 'skipped_non_inbox', id: messageId };
  }

  if (message.sizeEstimate && message.sizeEstimate > 200_000) {
    return { action: 'skipped', id: messageId };
  }

  const headerMap = toHeaderMap(message.payload?.headers);
  const rawSubject = getHeader(headerMap, 'subject') ?? 'Task';
  const subject = decodeRfc2047HeaderValue(rawSubject);
  const rawFromHeader = getHeader(headerMap, 'from');
  const fromHeader = rawFromHeader ? decodeRfc2047HeaderValue(rawFromHeader) : undefined;
  const snippet = message.snippet ?? '';
  const bulkSignals = hasBulkHeaderSignals(headerMap);
  const messageIdHeaderRaw = getHeader(headerMap, 'message-id')?.trim() ?? null;
  const messageIdHeader =
    messageIdHeaderRaw && messageIdHeaderRaw.startsWith('<') && messageIdHeaderRaw.endsWith('>')
      ? messageIdHeaderRaw.slice(1, -1).trim() || null
      : messageIdHeaderRaw;
  const externalId = messageIdHeader || message.id || null;
  const senderDomain =
    fromHeader?.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ??
    fromHeader?.match(/<([^>\s]+)>/)?.[1]?.toLowerCase() ??
    null;

  if (externalId && ignoredExternalIds.has(externalId)) {
    return { action: 'skipped_ignored', id: messageId };
  }

  if (senderDomain && suppressedSenderDomains?.has(senderDomain)) {
    const payload = {
      title: subject.trim() || 'Task',
      type: 'general' as const,
      status: 'done' as const,
      reviewState: 'ignored' as const,
      provider: 'gmail' as const,
      externalId: externalId ?? undefined,
      sourceId: message.id ?? undefined,
      sourceLink: message.id ? gmailMessageLink(accountEmail, message.id) : undefined,
      sender: fromHeader ?? undefined,
      senderDomain,
      rawSnippet: snippet,
      description: snippet,
      confidence: 1,
      syncedAt: now,
      careRecipientId,
      ingestionDebug: {
        reason: 'sender_suppressed',
        senderDomain,
        signals: {
          labelIds: labels,
          bulkSignals,
          marketing: looksMarketing(subject, snippet),
        },
      },
      createdById: caregiverId,
      updatedAt: now,
    };
    return { action: 'tombstoned', id: messageId, payload };
  }

  if (shouldTombstoneMessage(labels)) {
    const payload = {
      title: subject.trim() || 'Task',
      type: 'general' as const,
      status: 'done' as const,
      reviewState: 'ignored' as const,
      provider: 'gmail' as const,
      externalId: externalId ?? undefined,
      sourceId: message.id ?? undefined,
      sourceLink: message.id ? gmailMessageLink(accountEmail, message.id) : undefined,
      sender: fromHeader ?? undefined,
      senderDomain,
      rawSnippet: snippet,
      description: snippet,
      confidence: 1,
      syncedAt: now,
      careRecipientId,
      ingestionDebug: {
        reason: 'category_tombstone',
        signals: {
          labelIds: labels,
          bulkSignals,
          marketing: looksMarketing(subject, snippet),
        },
      },
      createdById: caregiverId,
      updatedAt: now,
    };
    return { action: 'tombstoned', id: messageId, payload };
  }

  const parsed = parse({ message, subject, sender: fromHeader, snippet });

  const heuristicTombstone = shouldTombstoneNonActionableMessage({
    subject,
    snippet,
    headerMap,
    bulkSignals,
    parsed,
  });

  if (heuristicTombstone.shouldTombstone) {
    const payload = {
      title: subject.trim() || 'Task',
      type: 'general' as const,
      status: 'done' as const,
      reviewState: 'ignored' as const,
      provider: 'gmail' as const,
      externalId: externalId ?? undefined,
      sourceId: message.id ?? undefined,
      sourceLink: message.id ? gmailMessageLink(accountEmail, message.id) : undefined,
      sender: fromHeader ?? undefined,
      senderDomain,
      rawSnippet: snippet,
      description: parsed.description ?? snippet,
      confidence: 1,
      syncedAt: now,
      careRecipientId,
      ingestionDebug: {
        reason: heuristicTombstone.reason,
        signals: {
          labelIds: labels,
          bulkSignals,
          marketing: looksMarketing(subject, snippet),
        },
      },
      createdById: caregiverId,
      updatedAt: now,
    };
    return { action: 'tombstoned', id: messageId, payload };
  }

  const extractedSignalLines = [
    parsed.startAt ? `startAt: ${parsed.startAt.toISOString()}` : null,
    parsed.endAt ? `endAt: ${parsed.endAt.toISOString()}` : null,
    parsed.location ? `location: ${parsed.location}` : null,
    parsed.organizer ? `organizer: ${parsed.organizer}` : null,
    typeof (parsed as any).amount === 'number' ? `amount: ${(parsed as any).amount}` : null,
    (parsed as any).currency ? `currency: ${(parsed as any).currency}` : null,
    parsed.dueAt ? `dueAt: ${parsed.dueAt.toISOString()}` : null,
    (parsed as any).referenceNumber ? `referenceNumber: ${(parsed as any).referenceNumber}` : null,
    (parsed as any).statementPeriod ? `statementPeriod: ${(parsed as any).statementPeriod}` : null,
    (parsed as any).vendor ? `vendor: ${(parsed as any).vendor}` : null,
    (parsed as any).dosage ? `dosage: ${(parsed as any).dosage}` : null,
    (parsed as any).frequency ? `frequency: ${(parsed as any).frequency}` : null,
    (parsed as any).route ? `route: ${(parsed as any).route}` : null,
    (parsed as any).prescribingProvider
      ? `prescribingProvider: ${(parsed as any).prescribingProvider}`
      : null,
  ].filter(Boolean);

  const classification = await classify({
    subject,
    snippet,
    body: [
      extractedSignalLines.length > 0
        ? `Extracted signals:\n${extractedSignalLines.join('\n')}`
        : null,
      `Body:\n${parsed.description ?? snippet}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    sender: fromHeader ?? null,
    labelIds: labels,
    headers: {
      from: fromHeader ?? undefined,
      'reply-to': getHeader(headerMap, 'reply-to'),
      'list-id': getHeader(headerMap, 'list-id'),
      'list-unsubscribe': getHeader(headerMap, 'list-unsubscribe'),
      precedence: getHeader(headerMap, 'precedence'),
      'auto-submitted': getHeader(headerMap, 'auto-submitted'),
      'x-auto-response-suppress': getHeader(headerMap, 'x-auto-response-suppress'),
    },
  });

  const classificationFailed = 'error' in classification;
  const bucket = asBucket(classification);
  const modelConfidence = asConfidence(classification);

  const decision = decideTaskRouting({
    bucket,
    classificationFailed,
    modelConfidence,
    parsed,
    subject,
    snippet,
    bulkSignals,
  });

  if (decision.shouldDrop) {
    return { action: 'skipped_low_confidence', id: messageId, bucket, decision, classification };
  }

  const description =
    classificationFailed && (parsed.description || snippet)
      ? `[model failed] ${parsed.description ?? snippet}`
      : parsed.description;

  const payload = {
    title: parsed.title,
    type: decision.taskType,
    status: decision.taskType === 'appointment' ? ('scheduled' as const) : ('todo' as const),
    reviewState: decision.reviewState,
    provider: 'gmail' as const,
    externalId: externalId ?? undefined,
    sourceId: message.id ?? undefined,
    sourceLink: message.id ? gmailMessageLink(accountEmail, message.id) : undefined,
    sender: fromHeader ?? undefined,
    senderDomain,
    rawSnippet: snippet,
    description,
    confidence: Number(decision.confidence.toFixed(2)),
    syncedAt: now,
    careRecipientId,
    ingestionId: undefined,
    ingestionDebug: {
      classification:
        'error' in classification
          ? { error: classification.error.message }
          : {
              label: classification.label,
              confidence: classification.confidence,
              reason: classification.reason,
              projectId: classification.projectId,
              rawText: classification.rawText,
            },
      signals: {
        labelIds: labels,
        bulkSignals,
        marketing: looksMarketing(subject, snippet),
        headers: {
          listUnsubscribe: getHeader(headerMap, 'list-unsubscribe'),
          listId: getHeader(headerMap, 'list-id'),
          precedence: getHeader(headerMap, 'precedence'),
          autoSubmitted: getHeader(headerMap, 'auto-submitted'),
          xAutoResponseSuppress: getHeader(headerMap, 'x-auto-response-suppress'),
          replyTo: getHeader(headerMap, 'reply-to'),
        },
      },
      decision: {
        taskType: decision.taskType,
        reviewState: decision.reviewState,
        confidence: decision.confidence,
        hasEvidence: decision.hasEvidence,
        shouldDrop: decision.shouldDrop,
      },
    },
    amount: (parsed as any).amount,
    currency: (parsed as any).amount ? ((parsed as any).currency ?? 'USD') : undefined,
    vendor: (parsed as any).vendor,
    referenceNumber: (parsed as any).referenceNumber,
    statementPeriod: (parsed as any).statementPeriod,
    medicationName: (parsed as any).medicationName,
    dosage: (parsed as any).dosage,
    frequency: (parsed as any).frequency,
    route: (parsed as any).route,
    nextDoseAt: (parsed as any).nextDoseAt,
    prescribingProvider: (parsed as any).prescribingProvider,
    startAt: (parsed as any).startAt,
    endAt: (parsed as any).endAt,
    location: (parsed as any).location,
    organizer: (parsed as any).organizer,
    dueAt: (parsed as any).dueAt,
    createdById: caregiverId,
    updatedAt: now,
  };

  return { action: 'upsert', id: messageId, payload, bucket, decision, classification };
};
