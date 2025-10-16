export function logInfo(message: string, meta?: unknown): void {
  if (meta) {
    console.log(`[GoogleSync] ${message}`, meta);
    return;
  }
  console.log(`[GoogleSync] ${message}`);
}

export function logError(message: string, meta?: unknown): void {
  if (meta) {
    console.error(`[GoogleSync] ${message}`, meta);
    return;
  }
  console.error(`[GoogleSync] ${message}`);
}

export function logWarn(message: string, meta?: unknown): void {
  if (meta) {
    console.warn(`[GoogleSync] ${message}`, meta);
    return;
  }
  console.warn(`[GoogleSync] ${message}`);
}
