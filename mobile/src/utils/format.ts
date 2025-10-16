interface CurrencyFormatOptions {
  currency?: string;
  unknownLabel?: string;
}

export const formatCurrency = (
  amount: number | null | undefined,
  { currency = 'USD', unknownLabel = 'Unknown amount' }: CurrencyFormatOptions = {}
): string => {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return unknownLabel;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
};
