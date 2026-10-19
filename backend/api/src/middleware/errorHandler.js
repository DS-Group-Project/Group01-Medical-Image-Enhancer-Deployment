import logger from "../utils/logger.js";

export function errorHandler(err, req, res, next) {
  logger.error({ err, path: req.path }, "Unhandled error");

  // CSRF validation failure
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "INVALID_CSRF_TOKEN" });
  }

  // Known business errors from repositories
  if (err.message === "EMAIL_ALREADY_EXISTS") {
    return res.status(409).json({ error: "EMAIL_ALREADY_EXISTS" });
  }

  // DynamoDB conditional check failures (idempotency guards)
  if (err.name === "ConditionalCheckFailedException") {
    return res.status(409).json({ error: "CONDITION_FAILED", message: err.message });
  }

  // Validation / bad input
  if (err.status === 400) {
    return res.status(400).json({ error: err.message || "BAD_REQUEST" });
  }

  // Multer upload errors (file size limit, max count, unexpected fields)
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "FILE_TOO_LARGE", message: "File exceeds the 50MB size limit." });
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "TOO_MANY_FILES", message: "Batch exceeds allowed image limit. Maximum is 100 images." });
    }
    return res.status(400).json({ error: "UPLOAD_ERROR", message: err.message });
  }

  res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
}
