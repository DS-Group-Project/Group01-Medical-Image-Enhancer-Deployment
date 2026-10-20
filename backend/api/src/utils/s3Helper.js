import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, RAW_BUCKET, PROCESSED_BUCKET } from "../app.js";

export async function getImageBase64(job) {
  const tryFetch = async (bucket, key) => {
    if (!bucket || !key) return null;
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(command);
    const byteArray = await response.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);

    let mimeType = "image/jpeg";
    const lower = key.toLowerCase();
    if (lower.endsWith(".png")) mimeType = "image/png";
    if (lower.endsWith(".webp")) mimeType = "image/webp";

    return {
      inlineData: {
        data: buffer.toString("base64"),
        mimeType
      }
    };
  };

  try {
    if (job.enhancedKey && PROCESSED_BUCKET) {
      try {
        return await tryFetch(PROCESSED_BUCKET, job.enhancedKey);
      } catch (err) {
        console.warn(`[S3-HELPER] Enhanced key not found in ${PROCESSED_BUCKET}, falling back to originalKey...`);
      }
    }
    if (job.originalKey && RAW_BUCKET) {
      return await tryFetch(RAW_BUCKET, job.originalKey);
    }
    return null;
  } catch (err) {
    console.error("[S3-HELPER] Failed to load image from S3:", err.message);
    return null;
  }
}

