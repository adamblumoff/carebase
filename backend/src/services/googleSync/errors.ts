export class GoogleSyncException extends Error {
  status?: number;
  code?: string;
  context?: Record<string, unknown>;

  constructor(message: string, status?: number, code?: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'GoogleSyncException';
    this.status = status;
    this.code = code;
    this.context = context;
  }
}
