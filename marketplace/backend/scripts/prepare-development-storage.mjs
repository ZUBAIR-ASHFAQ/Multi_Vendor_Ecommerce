import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:59010";
const bucket = process.env.STORAGE_BUCKET ?? "marketplace-dev";
const region = process.env.STORAGE_REGION ?? "us-east-1";
const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID ?? "marketplace-dev";
const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY ?? "marketplace-dev-secret";
const timeoutMs = 60_000;

const client = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

/** Sleeps briefly between object-storage readiness attempts. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Returns true when the configured development bucket already exists and is reachable. */
async function bucketExists() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || status === 403 || status === undefined) return false;
    throw error;
  }
}

/** Waits for local S3-compatible storage, then idempotently creates the dev bucket. */
async function prepareBucket() {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      if (!(await bucketExists())) {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`Created development storage bucket: ${bucket}`);
      }
      console.log(`Development storage bucket ready: ${bucket}`);
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(
    `Timed out preparing development object storage: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

try {
  await prepareBucket();
} finally {
  client.destroy();
}
