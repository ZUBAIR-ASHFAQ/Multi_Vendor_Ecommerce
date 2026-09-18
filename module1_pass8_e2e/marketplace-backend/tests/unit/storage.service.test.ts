import { DeleteObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3ObjectStorage } from "../../src/common/storage/s3-storage.service.js";

/** Builds the smallest S3 client double needed by the storage-adapter unit tests. */
function fakeS3Client(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

describe("S3/R2 storage adapter", () => {
  it("deletes objects through the configured bucket without storing blobs locally", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage(fakeS3Client(send), "test-bucket");

    await storage.deleteObject("products/seller-1/image.jpg");

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command?.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "products/seller-1/image.jpg",
    });
  });

  it("returns false only for a 404 HEAD result", async () => {
    const send = vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    const storage = new S3ObjectStorage(fakeS3Client(send), "test-bucket");

    await expect(storage.objectExists("missing.jpg")).resolves.toBe(false);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("rethrows unexpected storage failures", async () => {
    const failure = Object.assign(new Error("provider unavailable"), {
      $metadata: { httpStatusCode: 503 },
    });
    const send = vi.fn().mockRejectedValue(failure);
    const storage = new S3ObjectStorage(fakeS3Client(send), "test-bucket");

    await expect(storage.objectExists("image.jpg")).rejects.toBe(failure);
  });
});
