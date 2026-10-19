import { queryUserImages } from "../../database/src/jobsRepository.js";
import { ddb, JOBS_TABLE } from "../../database/src/dynamoClient.js";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getImageBase64 } from "./utils/s3Helper.js";
import { chatCompletion } from "./utils/llmClient.js";

export async function classifyAllImages() {
  console.log("=== STARTING VISUAL CLASSIFICATION OF ALL SCANS ===");
  const images = await queryUserImages("3fa6206d-d5c4-4fce-a569-d6f2de826734");
  console.log(`Found ${images.length} scans in user account.`);

  for (const img of images) {
    try {
      console.log(`Analyzing scan: ${img.filename} (JobId: ${img.jobId})...`);
      const imgData = await getImageBase64(img);
      if (!imgData) {
        console.log(`  ⚠ Could not load image bytes for ${img.filename}`);
        continue;
      }

      const res = await chatCompletion({
        messages: [{
          role: "user",
          content: [
            { 
              type: "text", 
              text: "Analyze this medical image strictly. Return ONLY ONE WORD representing the anatomical body part shown: chest, hand, wrist, arm, leg, foot, head, spine, or pelvis. If not a medical scan, return unspecified." 
            },
            { 
              type: "image_url", 
              image_url: { url: `data:${imgData.inlineData.mimeType};base64,${imgData.inlineData.data}` } 
            }
          ]
        }],
        maxTokens: 10
      });

      const detected = (res.content || "").trim().toLowerCase().replace(/[^a-z]/g, "");
      console.log(`  ✓ Visual AI detected: "${detected}" for ${img.filename}`);

      if (detected && detected !== "unspecified") {
        await ddb.send(new UpdateCommand({
          TableName: JOBS_TABLE,
          Key: { jobId: img.jobId },
          UpdateExpression: "SET bodyPart = :bp, updatedAt = :now",
          ExpressionAttributeValues: {
            ":bp": detected,
            ":now": new Date().toISOString()
          }
        }));
        console.log(`  ✓ Updated DynamoDB record for ${img.jobId} with bodyPart: "${detected}"`);
      }
    } catch (err) {
      console.error(`  ✕ Error analyzing ${img.jobId}:`, err.message);
    }
  }
  console.log("=== COMPLETED VISUAL CLASSIFICATION ===");
}

classifyAllImages().catch(console.error);
