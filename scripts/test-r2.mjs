#!/usr/bin/env node
/**
 * Cloudflare R2 connectivity probe.
 *
 * Usage:  npm run r2:test
 *
 * Loads .env (node --env-file) the same way email:test does, then performs a
 * full round trip against your bucket: PUT a tiny probe object -> GET it back
 * and compare -> DELETE it. Confirms account id, access key, secret, bucket,
 * and endpoint before you trust real brief uploads to it.
 *
 * Exits non-zero on any configuration, signing, or I/O failure so it fails CI.
 * Respects the optional R2_ENDPOINT override (used to point at local
 * S3-compatible storage for tests/demos).
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT } =
  process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error(
    "[r2] Not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME in .env (see .env.example)."
  );
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const key = `scope-r2-test/probe-${Date.now()}.txt`;
const body = Buffer.from("scope-r2-connectivity-probe\n");

try {
  await client.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: body }));
  console.log(`[r2] PUT ok: s3://${R2_BUCKET_NAME}/${key}`);

  const got = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  const bytes = await got.Body.transformToByteArray();
  if (Buffer.compare(Buffer.from(bytes), body) !== 0) {
    console.error("[r2:error] GET returned different bytes than PUT sent — storage is corrupt.");
    process.exit(1);
  }
  console.log(`[r2] GET ok: round-trip bytes match (${bytes.length} bytes)`);

  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  console.log(`[r2] DELETE ok: probe object removed`);

  console.log(`[r2] R2 OK: bucket "${R2_BUCKET_NAME}" reachable at ${R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`}`);
} catch (error) {
  console.error(
    `[r2:error] R2 probe failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}