/**
 * A failure the user can understand and act on - shown in the UI as-is.
 * Anything else that escapes becomes a generic 500.
 */
export class AppError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(message, 400, details);
export const unauthorized = (message = 'Please sign in.') => new AppError(message, 401);
export const forbidden = (message = 'You do not have permission to do this.') =>
  new AppError(message, 403);
export const notFound = (message = 'Not found.') => new AppError(message, 404);
export const conflict = (message, details) => new AppError(message, 409, details);
