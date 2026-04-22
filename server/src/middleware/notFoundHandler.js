module.exports = function notFoundHandler(req, res) {
  res.status(404).json({
    detail: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};
