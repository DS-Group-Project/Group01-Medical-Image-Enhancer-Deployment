import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamoClient.js";
import crypto from "crypto";

export const SESSIONS_TABLE = "Sessions";

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Create a new refresh-token session.
 *
 * Pass `familyId` when rotating an existing session (keeps the chain of
 * tokens linked for reuse detection). Omit it on a fresh login/register to
 * start a brand-new family.
 *
 * We never store the raw token — only its SHA-256 hash — so a DynamoDB
 * read/backup leak can't be replayed as a live session.
 */
export async function createSession(userId, familyId) {
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(refreshToken);
  const fId = familyId || crypto.randomUUID();
  const nowSeconds = Math.floor(Date.now() / 1000);

  await ddb.send(new PutCommand({
    TableName: SESSIONS_TABLE,
    Item: {
      tokenHash,
      userId,
      familyId: fId,
      createdAt: nowSeconds,
      // Also usable as a DynamoDB TTL attribute if you enable TTL on this table.
      expiresAt: nowSeconds + REFRESH_TOKEN_TTL_SECONDS,
      used: false,
      revoked: false,
    },
  }));

  return { refreshToken, familyId: fId };
}

/** Look up a session by the raw refresh token the client presented. */
export async function getSession(refreshToken) {
  const res = await ddb.send(new GetCommand({
    TableName: SESSIONS_TABLE,
    Key: { tokenHash: hashToken(refreshToken) },
  }));
  return res.Item ?? null;
}

/**
 * Mark a token as used (rotated) instead of deleting it. Keeping the row is
 * what makes reuse detection possible: if this same refresh token is ever
 * presented again, getSession() will find it and see `used: true`, which is
 * the signal that it was stolen and replayed rather than "never existed".
 * (A version of this that hard-deletes on rotation loses that signal —
 * a reused token then looks identical to an invalid one, and theft goes
 * undetected. Don't switch this to a DeleteCommand.)
 */
export async function markSessionUsed(refreshToken) {
  await ddb.send(new UpdateCommand({
    TableName: SESSIONS_TABLE,
    Key: { tokenHash: hashToken(refreshToken) },
    UpdateExpression: "SET used = :u",
    ExpressionAttributeValues: { ":u": true },
  }));
}

/**
 * Revoke every token in a family — used on logout, and automatically when
 * reuse of an already-rotated token is detected (treat the whole chain as
 * compromised, not just the one token).
 *
 * Requires a Global Secondary Index named "FamilyIndex" on the Sessions
 * table, partitioned on `familyId`.
 */
export async function revokeFamily(familyId) {
  const res = await ddb.send(new QueryCommand({
    TableName: SESSIONS_TABLE,
    IndexName: "FamilyIndex",
    KeyConditionExpression: "familyId = :f",
    ExpressionAttributeValues: { ":f": familyId },
  }));

  const items = res.Items || [];
  await Promise.all(items.map((item) =>
    ddb.send(new UpdateCommand({
      TableName: SESSIONS_TABLE,
      Key: { tokenHash: item.tokenHash },
      UpdateExpression: "SET revoked = :r",
      ExpressionAttributeValues: { ":r": true },
    }))
  ));
}
