class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class ValidationError extends ApiError {
  constructor(message, details) {
    super(400, message, details);
  }
}

class NotFoundError extends ApiError {
  constructor(message) {
    super(404, message);
  }
}

class ConflictError extends ApiError {
  constructor(message) {
    super(409, message);
  }
}

class ForbiddenError extends ApiError {
  constructor(message) {
    super(403, message);
  }
}

class InsufficientFundsError extends ApiError {
  constructor(message) {
    super(400, message);
  }
}

class InsufficientSharesError extends ApiError {
  constructor(message) {
    super(400, message);
  }
}

class MarketPausedError extends ApiError {
  constructor(message = "Trading is currently paused. Check back soon.") {
    super(503, message);
  }
}

module.exports = {
  ApiError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InsufficientFundsError,
  InsufficientSharesError,
  MarketPausedError,
};
