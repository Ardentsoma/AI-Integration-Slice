import "server-only";

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

/**
 * Brief file storage backed by Cloudflare R2 via its S3-compatible endpoint.
 * Only the object key is ever persisted to PostgreSQL — the file bytes live
 * in R2 and never touch the database.
 */

export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Cloudflare R2 is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME to .env."
    );
    this.name = "StorageNotConfiguredError";
  }
}

let r2Client: S3Client | null = null;

/** Lazily builds the R2 S3 client so the module can be imported even when
 * R2 isn't configured yet (the error surfaces only when storage is used). */
function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new StorageNotConfiguredError();
  }

  const config: S3ClientConfig = {
    // R2's S3-compatible API expects the account-specific hostname; the
    // "auto" region is what Cloudflare's documentation prescribes. The
    // R2_ENDPOINT override is optional and lets tests (or a self-hosted
    // S3-compatible bucket) point the client somewhere else.
    region: "auto",
    endpoint:
      process.env.R2_ENDPOINT ??
      `https://${accountId}.r2.cloudflarestorage.com`,
    // AWS defaults to virtual-hosted-style buckets; R2 serves buckets on the
    // account hostname, so force path-style addressing (endpoint/bucket/key).
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  };

  r2Client = new S3Client(config);
  return r2Client;
}

function getBucket(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new StorageNotConfiguredError();
  return bucket;
}

/** Normalizes an uploaded file name into a safe key segment (no paths, no
 * control chars, ASCII-ish fallback) to avoid surprises in object keys. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[^\w.\- ]/g, "_");
  return base.slice(0, 80).trim() || "brief";
}

/** Object key layout: briefs/{userId}/{jobId}/{originalName}. The job id is
 * included so the uploaded file is addressable from the job row alone. */
export function buildBriefStorageKey(
  userId: string,
  jobId: string,
  originalName: string
): string {
  return `briefs/${userId}/${jobId}/${sanitizeFileName(originalName)}`;
}

/** Uploads brief bytes to R2. Returns the object key just written. */
export async function putBrief(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string }> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
  return { key: params.key };
}

/** Downloads a brief object from R2 and returns it as an in-memory Buffer,
 * ready for text extraction. (Binary never reaches PostgreSQL.) */
export async function getBriefFile(key: string): Promise<{
  buffer: Buffer;
  contentType: string;
}> {
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key })
  );
  if (!response.Body) {
    throw new Error(`R2 returned no content for object "${key}".`);
  }
  const bytes = await response.Body.transformToByteArray();
  const contentType = response.ContentType ?? "application/octet-stream";
  return { buffer: Buffer.from(bytes), contentType };
}