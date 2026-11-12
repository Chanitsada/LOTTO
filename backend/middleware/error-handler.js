function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found.' },
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.publicError === true && Number.isInteger(error.status)) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }

  if (error.code === 'VALIDATION_ERROR') {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: error.message },
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' },
    });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' },
    });
  }

  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
}

module.exports = { notFound, errorHandler };
