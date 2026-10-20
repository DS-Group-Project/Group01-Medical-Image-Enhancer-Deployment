import { PutCommand, GetCommand, BatchGetCommand, QueryCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, JOBS_TABLE } from "./dynamoClient.js";
import { randomUUID } from "crypto";

/** Helper: Infer anatomical region if not provided */
function detectBodyPart(filename = "") {
  const name = filename.toLowerCase();
  if (name.includes("hand") || name.includes("wrist") || name.includes("finger")) return "hand";
  if (name.includes("leg") || name.includes("knee") || name.includes("tibia") || name.includes("femur") || name.includes("ankle") || name.includes("foot")) return "leg";
  if (name.includes("chest") || name.includes("thorax") || name.includes("lung")) return "chest";
  if (name.includes("head") || name.includes("skull") || name.includes("brain")) return "head";
  return "unspecified";
}

/** Create a job record. Idempotent — rejects duplicate jobId. */
export async function createJob({ userId, filename, originalKey, bodyPart, fileSize }) {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const resolvedBodyPart = bodyPart || detectBodyPart(filename);

  const job = {
    jobId, 
    userId, 
    filename, 
    originalKey,
    fileSize: typeof fileSize === 'number' ? fileSize : null,
    bodyPart: resolvedBodyPart,
    status: "pending",
    enhancedKey: null,
    progress: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  await ddb.send(new PutCommand({
    TableName: JOBS_TABLE,
    Item: job,
    ConditionExpression: "attribute_not_exists(jobId)",
  }));

  return job;
}

/** Get a single job by id. */
export async function getJob(jobId) {
  const res = await ddb.send(new GetCommand({ TableName: JOBS_TABLE, Key: { jobId } }));
  return res.Item ?? null;
}

/** Get multiple jobs by their IDs (supports up to 100 IDs via DynamoDB BatchGetItem) */
export async function getJobsByIds(jobIds) {
  if (!Array.isArray(jobIds) || jobIds.length === 0) return [];
  const uniqueIds = Array.from(new Set(jobIds)).filter(Boolean).slice(0, 100);
  if (uniqueIds.length === 0) return [];

  const res = await ddb.send(new BatchGetCommand({
    RequestItems: {
      [JOBS_TABLE]: {
        Keys: uniqueIds.map(jobId => ({ jobId })),
      },
    },
  }));

  const items = res.Responses?.[JOBS_TABLE] || [];
  const itemMap = new Map(items.map(item => [item.jobId, item]));
  return uniqueIds.map(id => itemMap.get(id)).filter(Boolean);
}

/**
 * Search and filter jobs for a specific user based on bodyPart or filename.
 * Used directly by Veda Agent.
 */
export async function queryUserImages(userId, { bodyPart, query } = {}) {
  // Query all user jobs first via GSI
  const res = await ddb.send(new QueryCommand({
    TableName: JOBS_TABLE,
    IndexName: "UserJobsIndex",
    KeyConditionExpression: "userId = :u",
    ExpressionAttributeValues: {
      ":u": userId,
    },
    ScanIndexForward: false,
  }));

  let items = res.Items || [];

  // Completed jobs පමණක් තෝරා ගනිමු
  items = items.filter(item => item.status === "completed");

  // Filter by anatomical bodyPart
  if (bodyPart) {
    const target = bodyPart.toLowerCase();
    items = items.filter(item => {
      const part = (item.bodyPart || detectBodyPart(item.filename)).toLowerCase();
      return part === target || item.filename.toLowerCase().includes(target);
    });
  }

  // Filter by generic search query
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(item => {
      const filenameMatch = item.filename && item.filename.toLowerCase().includes(q);
      const bodyPartMatch = (item.bodyPart || detectBodyPart(item.filename)).toLowerCase().includes(q);
      return filenameMatch || bodyPartMatch;
    });
  }

  return items;
}

/**
 * Save detected abnormality markers to job item (cache for future questions)
 */
export async function updateJobAbnormality(jobId, analysisData) {
  const now = new Date().toISOString();
  return ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: "SET analysis = :analysis, updatedAt = :now",
    ExpressionAttributeValues: {
      ":analysis": analysisData,
      ":now": now,
    },
  }));
}

/** List a user's jobs, newest first, paginated, optional status filter. */
export async function listJobsForUser(userId, { limit = 10, cursor, status } = {}) {
  const clampedLimit = Math.max(1, Math.min(100, Number(limit) || 10));

  const res = await ddb.send(new QueryCommand({
    TableName: JOBS_TABLE,
    IndexName: "UserJobsIndex",
    KeyConditionExpression: "userId = :u",
    ExpressionAttributeValues: {
      ":u": userId,
      ...(status && { ":s": status }),
    },
    ...(status && { FilterExpression: "#st = :s", ExpressionAttributeNames: { "#st": "status" } }),
    ScanIndexForward: false,
    Limit: clampedLimit,
    ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64").toString()) : undefined,
  }));

  return {
    jobs: res.Items,
    nextCursor: res.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64")
      : null,
  };
}

/** pending -> processing. Fails harmlessly if already past pending (idempotency guard). */
export async function markProcessing(jobId) {
  const now = new Date().toISOString();
  return ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: "SET #st = :processing, updatedAt = :now",
    ConditionExpression: "#st = :pending",
    ExpressionAttributeNames: { "#st": "status" },
    ExpressionAttributeValues: { ":processing": "processing", ":pending": "pending", ":now": now },
  }));
}

/** processing -> completed */
export async function markCompleted(jobId, enhancedKey, bodyPart) {
  const now = new Date().toISOString();
  
  // Existing record එකෙන් filename බලා bodyPart resolve කිරීම
  const existing = await getJob(jobId);
  const resolvedBodyPart = bodyPart || existing?.bodyPart || detectBodyPart(existing?.filename);

  return ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: "SET #st = :completed, enhancedKey = :ek, bodyPart = :bp, completedAt = :ca, updatedAt = :ca, progress = :p",
    ConditionExpression: "#st = :processing",
    ExpressionAttributeNames: { "#st": "status" },
    ExpressionAttributeValues: {
      ":completed": "completed", 
      ":processing": "processing",
      ":ek": enhancedKey, 
      ":bp": resolvedBodyPart,
      ":ca": now, 
      ":p": 100,
    },
  }));
}

/** any status -> failed */
export async function markFailed(jobId, errorMessage) {
  const now = new Date().toISOString();
  return ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: "SET #st = :failed, #err = :err, updatedAt = :now",
    ExpressionAttributeNames: { "#st": "status", "#err": "error" },
    ExpressionAttributeValues: { ":failed": "failed", ":err": errorMessage, ":now": now },
  }));
}

/** Hard delete a job */
export async function deleteJobRecord(jobId) {
  return ddb.send(new DeleteCommand({ TableName: JOBS_TABLE, Key: { jobId } }));
}

/** Explicitly update the anatomical body part detected visually */
export async function setJobBodyPart(jobId, bodyPart) {
  const now = new Date().toISOString();
  return ddb.send(new UpdateCommand({
    TableName: JOBS_TABLE,
    Key: { jobId },
    UpdateExpression: "SET bodyPart = :bp, updatedAt = :now",
    ExpressionAttributeValues: {
      ":bp": bodyPart,
      ":now": now,
    },
  }));
}