export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends HttpError {
  constructor(details?: unknown) {
    super('Validation failed', 400, details);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string = 'Resource not found', details?: unknown) {
    super(message, 404, details);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string = 'Not authenticated', details?: unknown) {
    super(message, 401, details);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string = 'Forbidden', details?: unknown) {
    super(message, 403, details);
  }
}
