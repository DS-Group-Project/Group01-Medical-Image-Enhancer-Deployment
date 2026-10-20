import "dotenv/config";

// Ensure Windows local certificate chains do not break AWS S3, DynamoDB, or external TLS handshakes
if (process.platform === "win32" && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

import app from "./app.js";
import logger from "./utils/logger.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  logger.info(`API running on http://localhost:${PORT}`);
});
