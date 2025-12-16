export const SENDER_SUPPRESSION_IGNORE_THRESHOLD = 3;

export const normalizeDomainInput = (value: string) =>
  value.trim().toLowerCase().replace(/^@+/, '');

export const parseSenderDomain = (sender?: string | null, senderDomain?: string | null) => {
  const explicit = senderDomain?.trim().toLowerCase();
  if (explicit) return explicit;
  if (!sender) return null;
  const match = sender.match(/@([^>\s]+)/);
  return match?.[1]?.toLowerCase() ?? null;
};

export const shouldSuppressAfterIgnore = ({
  currentIgnoreCount,
  threshold = SENDER_SUPPRESSION_IGNORE_THRESHOLD,
}: {
  currentIgnoreCount: number;
  threshold?: number;
}) => currentIgnoreCount + 1 >= threshold;
