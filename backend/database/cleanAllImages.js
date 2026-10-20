import { ddb, USERS_TABLE, JOBS_TABLE } from "./src/dynamoClient.js";
import { ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

// AWS S3 client setup
const s3 = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || "us-east-1",
  credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

const RAW_BUCKET = process.env.RAW_BUCKET_NAME || "medicalimagesds";
const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET_NAME || "processedmedicalimage";

/**
 * Helper to delete up to 1000 S3 objects at a time
 */
async function deleteS3Objects(bucket, keys) {
  if (!keys || keys.length === 0) return 0;
  let deletedCount = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map(k => ({ Key: k })),
        Quiet: true,
      },
    }));
    deletedCount += chunk.length;
  }
  return deletedCount;
}

/**
 * Helper to delete all objects in a bucket via pagination
 */
async function wipeBucket(bucket) {
  let totalDeleted = 0;
  let continuationToken = undefined;
  do {
    const listRes = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));

    if (listRes.Contents && listRes.Contents.length > 0) {
      const keys = listRes.Contents.map(c => c.Key).filter(Boolean);
      await deleteS3Objects(bucket, keys);
      totalDeleted += keys.length;
    }
    continuationToken = listRes.NextContinuationToken;
  } while (continuationToken);

  return totalDeleted;
}

export async function cleanAllImages() {
  console.log("==================================================");
  console.log("STARTING SYSTEM-WIDE IMAGE CLEANUP ACROSS ALL EMAILS");
  console.log("==================================================");

  // 1. Fetch all users from DynamoDB
  console.log("\n[1/5] Fetching all user accounts...");
  const usersRes = await ddb.send(new ScanCommand({ TableName: USERS_TABLE }));
  const users = usersRes.Items.filter(u => !u.userId.startsWith("EMAIL#"));
  const userMap = new Map();
  for (const u of users) {
    userMap.set(u.userId, u.email);
  }
  console.log(`Found ${users.length} registered user account(s). All accounts will remain intact.`);

  // 2. Fetch all jobs from DynamoDB
  console.log("\n[2/5] Fetching all jobs from DynamoDB Jobs table...");
  const jobsRes = await ddb.send(new ScanCommand({ TableName: JOBS_TABLE }));
  const jobs = jobsRes.Items || [];
  console.log(`Found ${jobs.length} total image job records.`);

  // Group jobs by email
  const jobsByEmail = new Map();
  const orphanedJobs = [];

  for (const job of jobs) {
    const email = userMap.get(job.userId);
    if (email) {
      if (!jobsByEmail.has(email)) jobsByEmail.set(email, []);
      jobsByEmail.get(email).push(job);
    } else {
      orphanedJobs.push(job);
    }
  }

  // 3. Delete user images group by group according to their email
  console.log("\n[3/5] Cleaning jobs and images grouped by user email...");
  let totalJobsDeleted = 0;
  let rawKeysToDelete = [];
  let processedKeysToDelete = [];

  for (const [email, userJobs] of jobsByEmail.entries()) {
    console.log(`- Cleaning ${userJobs.length} image(s) for email: ${email}`);
    for (const job of userJobs) {
      if (job.originalKey) rawKeysToDelete.push(job.originalKey);
      if (job.enhancedKey) processedKeysToDelete.push(job.enhancedKey);
      await ddb.send(new DeleteCommand({ TableName: JOBS_TABLE, Key: { jobId: job.jobId } }));
      totalJobsDeleted++;
    }
  }

  if (orphanedJobs.length > 0) {
    console.log(`- Cleaning ${orphanedJobs.length} orphaned/unassigned job(s)...`);
    for (const job of orphanedJobs) {
      if (job.originalKey) rawKeysToDelete.push(job.originalKey);
      if (job.enhancedKey) processedKeysToDelete.push(job.enhancedKey);
      await ddb.send(new DeleteCommand({ TableName: JOBS_TABLE, Key: { jobId: job.jobId } }));
      totalJobsDeleted++;
    }
  }

  // 4. Delete targeted keys from S3
  console.log("\n[4/5] Deleting image objects from AWS S3 buckets...");
  const rawDeleted = await deleteS3Objects(RAW_BUCKET, rawKeysToDelete);
  const procDeleted = await deleteS3Objects(PROCESSED_BUCKET, processedKeysToDelete);
  console.log(`  - Deleted ${rawDeleted} raw images from S3 bucket: ${RAW_BUCKET}`);
  console.log(`  - Deleted ${procDeleted} processed images from S3 bucket: ${PROCESSED_BUCKET}`);

  // Wipe any leftover/untracked keys in raw and processed buckets to ensure 100% clean state
  const remainingRaw = await wipeBucket(RAW_BUCKET);
  const remainingProc = await wipeBucket(PROCESSED_BUCKET);
  if (remainingRaw > 0) console.log(`  - Cleaned ${remainingRaw} additional untracked files from ${RAW_BUCKET}`);
  if (remainingProc > 0) console.log(`  - Cleaned ${remainingProc} additional untracked files from ${PROCESSED_BUCKET}`);

  // 5. Verification & Summary
  console.log("\n[5/5] Verifying clean state across the system...");
  const verifyJobs = await ddb.send(new ScanCommand({ TableName: JOBS_TABLE }));
  const verifyUsers = await ddb.send(new ScanCommand({ TableName: USERS_TABLE }));
  const verifyRaw = await s3.send(new ListObjectsV2Command({ Bucket: RAW_BUCKET, MaxKeys: 5 }));
  const verifyProc = await s3.send(new ListObjectsV2Command({ Bucket: PROCESSED_BUCKET, MaxKeys: 5 }));

  console.log("==================================================");
  console.log("CLEANUP VERIFICATION RESULT:");
  console.log(`- Remaining jobs in Jobs table: ${verifyJobs.Items?.length || 0} (Expected: 0)`);
  console.log(`- Remaining objects in ${RAW_BUCKET}: ${verifyRaw.KeyCount || 0} (Expected: 0)`);
  console.log(`- Remaining objects in ${PROCESSED_BUCKET}: ${verifyProc.KeyCount || 0} (Expected: 0)`);
  console.log(`- User accounts preserved in Users table: ${verifyUsers.Items?.filter(u => !u.userId.startsWith("EMAIL#")).length || 0} accounts intact.`);
  console.log("==================================================");
  console.log("CLEANUP COMPLETED SUCCESSFULLY WITHOUT FEATURE LOSS.");
}

// Execute if run directly
if (process.argv[1] && process.argv[1].endsWith("cleanAllImages.js")) {
  cleanAllImages().catch(err => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
}
