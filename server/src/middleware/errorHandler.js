const { ApiError } = require("../utils/errors");

module.exports = function errorHandler(error, _req, res, _next) {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      detail: error.message,
      errors: error.details || undefined,
    });
    return;
  }

  if (error && error.message === "Origin not allowed by CORS") {
    res.status(403).json({
      detail: error.message,
    });
    return;
  }

  console.error(error);
  res.status(500).json({
    detail: "Internal server error.",
  });
};
