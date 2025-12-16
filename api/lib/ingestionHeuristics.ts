export type HeaderPair = { name?: string | null; value?: string | null };

export type ParsedDetailsLike = {
  title: string;
  type: 'appointment' | 'bill' | 'medication' | 'general';
  confidence: number;
  description?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  location?: string | null;
  organizer?: string | null;
  amount?: number | null;
  currency?: string | null;
  dueAt?: Date | null;
  referenceNumber?: string | null;
  statementPeriod?: string | null;
  vendor?: string | null;
  medicationName?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  nextDoseAt?: Date | null;
  prescribingProvider?: string | null;
};

export const toHeaderMap = (headers?: HeaderPair[] | null): Record<string, string | undefined> => {
  const map: Record<string, string | undefined> = {};
  (headers ?? []).forEach((h) => {
    const key = h.name?.trim();
    if (!key) return;
    map[key.toLowerCase()] = h.value ?? undefined;
  });
  return map;
};

export const getHeader = (
  headerMap: Record<string, string | undefined>,
  name: string
): string | undefined => headerMap[name.toLowerCase()];

export const hasBulkHeaderSignals = (headerMap: Record<string, string | undefined>) => {
  const listUnsubscribe = Boolean(getHeader(headerMap, 'list-unsubscribe'));
  const listId = Boolean(getHeader(headerMap, 'list-id'));
  const precedence = (getHeader(headerMap, 'precedence') ?? '').toLowerCase();
  const autoSubmitted = (getHeader(headerMap, 'auto-submitted') ?? '').toLowerCase();
  const xAutoResponseSuppress = Boolean(getHeader(headerMap, 'x-auto-response-suppress'));
  return (
    listUnsubscribe ||
    listId ||
    precedence.includes('bulk') ||
    precedence.includes('list') ||
    autoSubmitted.includes('auto-') ||
    xAutoResponseSuppress
  );
};

export const isPromotionsCategory = (labelIds: string[]) =>
  labelIds.some(
    (id) => id === 'CATEGORY_PROMOTIONS' || id === 'CATEGORY_SOCIAL' || id === 'CATEGORY_FORUMS'
  );

export const shouldTombstoneMessage = (labelIds: string[]) => {
  return isPromotionsCategory(labelIds);
};

export const looksMarketing = (subject: string, snippet: string) => {
  const marketingKeywords =
    /\b(%\s*off|discount|sale|bogo|coupon|deal|promo|offer|flash sale|limited[- ]time)\b/i;
  return marketingKeywords.test(`${subject} ${snippet}`);
};

export const hasEvidenceForType = ({
  taskType,
  parsed,
  snippet,
}: {
  taskType: 'appointment' | 'bill' | 'medication' | 'general';
  parsed: ParsedDetailsLike;
  snippet: string;
}) => {
  const haystack = `${parsed.title} ${snippet} ${parsed.description ?? ''}`.toLowerCase();
  if (taskType === 'appointment') {
    const keyword = /\b(appointment|appt|calendar|visit|provider|clinic|doctor|dr\.)\b/.test(
      haystack
    );
    const metadataSignals = Boolean(parsed.location || parsed.organizer);
    const datetimeOnly = Boolean(parsed.startAt) && !metadataSignals && !keyword;
    if (datetimeOnly) return false;
    return Boolean(parsed.startAt || parsed.location || parsed.organizer) || keyword;
  }
  if (taskType === 'bill') {
    return (
      Boolean(
        parsed.amount ||
          parsed.dueAt ||
          parsed.referenceNumber ||
          parsed.statementPeriod ||
          parsed.vendor
      ) || /\b(amount due|invoice|payment due|past due|due by|due on)\b/.test(haystack)
    );
  }
  if (taskType === 'medication') {
    return (
      Boolean(parsed.dosage || parsed.frequency || parsed.prescribingProvider) ||
      /\b(rx|refill|prescription|pharmacy)\b/.test(haystack)
    );
  }
  return true;
};

export type ClassificationBucket =
  | 'appointments'
  | 'bills'
  | 'medications'
  | 'needs_review'
  | 'ignore'
  | null;

export type RoutingDecision = {
  taskType: 'appointment' | 'bill' | 'medication' | 'general';
  reviewState: 'pending' | 'approved' | 'ignored';
  confidence: number;
  hasEvidence: boolean;
  shouldDrop: boolean;
};

export const decideTaskRouting = ({
  bucket,
  classificationFailed,
  modelConfidence,
  parsed,
  subject,
  snippet,
  bulkSignals,
}: {
  bucket: ClassificationBucket;
  classificationFailed: boolean;
  modelConfidence: number | null;
  parsed: ParsedDetailsLike;
  subject: string;
  snippet: string;
  bulkSignals: boolean;
}): RoutingDecision => {
  let confidence = modelConfidence ?? parsed.confidence;
  const marketing = looksMarketing(subject, snippet);

  if (!classificationFailed && bulkSignals && bucket !== 'ignore' && bucket !== 'needs_review') {
    confidence = Math.max(0, confidence - 0.25);
  }

  let reviewState: 'pending' | 'approved' | 'ignored' = 'approved';
  if (bucket === 'ignore') {
    reviewState = 'ignored';
  } else if (bucket === 'needs_review' || classificationFailed || confidence < 0.8) {
    reviewState = 'pending';
  }

  const taskType =
    bucket === 'appointments'
      ? 'appointment'
      : bucket === 'bills'
        ? 'bill'
        : bucket === 'medications'
          ? 'medication'
          : parsed.type;

  if (marketing && bucket !== 'ignore') {
    reviewState = 'pending';
  }

  const hasEvidence =
    !classificationFailed && bucket && bucket !== 'ignore' && bucket !== 'needs_review'
      ? hasEvidenceForType({ taskType, parsed, snippet })
      : true;

  if (!classificationFailed && bucket && bucket !== 'ignore' && bucket !== 'needs_review') {
    if (!hasEvidence) {
      confidence = Math.max(0, confidence - 0.2);
      reviewState = 'pending';
    } else if (confidence < 0.85) {
      reviewState = 'pending';
    }
  }

  if (!classificationFailed && bulkSignals && bucket !== 'ignore') {
    reviewState = 'pending';
  }

  const shouldDrop =
    !classificationFailed &&
    confidence < 0.6 &&
    bucket !== null &&
    bucket !== 'needs_review' &&
    bucket !== 'ignore' &&
    !hasEvidence &&
    !bulkSignals &&
    !marketing;

  return { taskType, reviewState, confidence, hasEvidence, shouldDrop };
};
