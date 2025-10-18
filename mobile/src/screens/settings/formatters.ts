export function formatLastSynced(date: Date | null): string {
  if (!date) return 'Never synced';

  try {
    return date.toLocaleString();
  } catch {
    return 'Unknown';
  }
}
