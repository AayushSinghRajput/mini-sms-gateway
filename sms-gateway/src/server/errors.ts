// Typed application errors. Each maps to an HTTP status + stable error code.

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export interface InvalidNumber { input: string; reason: string }

export class InvalidNumbersError extends AppError {
  constructor(invalidNumbers: InvalidNumber[]) {
    super(400, "INVALID_NUMBERS", `${invalidNumbers.length} invalid phone number(s). Nothing was sent or charged.`, { invalidNumbers });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid authentication token") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class InsufficientCreditsError extends AppError {
  constructor(public readonly needed: number, public readonly available: number) {
    super(402, "INSUFFICIENT_CREDITS", `Not enough credits: need ${needed}, have ${available}.`, { needed, available });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class EmailTakenError extends AppError {
  constructor() {
    super(409, "EMAIL_TAKEN", "An account with this email already exists");
  }
}

export class RateLimitedError extends AppError {
  constructor(limit: number, retryAfterSeconds: number) {
    const retry = Math.max(1, Math.ceil(retryAfterSeconds));
    super(429, "RATE_LIMITED", `Rate limit exceeded (${limit} requests per minute). Retry in ${retry}s.`,
      { limit, retryAfterSeconds: retry }, { "Retry-After": String(retry) });
  }
}
