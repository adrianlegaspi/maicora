/**
 * Domain error hierarchy shared by every package. Keeping a single set of
 * error classes lets the API layer map errors to HTTP status codes in one
 * place instead of every route re-inventing the mapping.
 */

export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "CONFLICT"
  | "APPROVAL_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "FISCAL_ERROR"
  | "UNAUTHENTICATED";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super("NOT_FOUND", `${entity} ${id} not found`, { entity, id });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not permitted") {
    super("FORBIDDEN", message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHENTICATED", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, details);
  }
}

/**
 * Raised when a capability that requires an approved Business Proposal is
 * invoked directly instead of through the proposal/approval workflow.
 * See docs/mvp/09-proposals-and-governance.md.
 */
export class ApprovalRequiredError extends AppError {
  constructor(action: string) {
    super("APPROVAL_REQUIRED", `${action} requires an approved proposal`, { action });
  }
}

/**
 * Raised when an idempotency key is reused with a different payload, or when
 * an already-executed proposal is executed again. Protects fiscal operations
 * from duplicate execution (docs/mvp/12-agent-evaluations.md).
 */
export class IdempotencyConflictError extends AppError {
  constructor(message = "Operation already executed") {
    super("IDEMPOTENCY_CONFLICT", message);
  }
}

export class FiscalError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("FISCAL_ERROR", message, details);
  }
}
