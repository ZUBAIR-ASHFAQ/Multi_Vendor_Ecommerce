import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:59000";
const bucket = process.env.STORAGE_BUCKET ?? "marketplace-module21-e2e";
const region = process.env.STORAGE_REGION ?? "us-east-1";
const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID ?? "marketplace-e2e";
const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY ?? "marketplace-e2e-secret";
const timeoutMs = 60_000;
const frontendOrigin = process.env.E2E_FRONTEND_ORIGIN ?? "http://127.0.0.1:5173";

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

/** Returns true when the configured bucket already exists and is reachable. */
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

/** Applies the browser CORS policy needed only by the controlled E2E bucket. */
async function configureBucketCors() {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "HEAD", "PUT"],
            AllowedOrigins: [frontendOrigin, "http://localhost:5173"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 300,
          },
        ],
      },
    }),
  );
}

/** Waits for the S3-compatible test provider and creates/configures the deterministic E2E bucket. */
async function prepareBucket() {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      if (!(await bucketExists())) {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`Created Module 21 E2E bucket: ${bucket}`);
      }
      await configureBucketCors();
      console.log(`Module 21 E2E bucket ready: ${bucket}`);
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  throw new Error(
    `Timed out preparing Module 21 E2E storage: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

try {
  await prepareBucket();
} finally {
  client.destroy();
}
