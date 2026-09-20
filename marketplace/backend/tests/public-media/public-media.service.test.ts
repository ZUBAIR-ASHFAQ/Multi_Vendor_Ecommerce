import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ERROR_CODE } from "../../src/common/errors/error-codes.js";
import type { ObjectStorage } from "../../src/common/storage/storage.contract.js";
import { PUBLIC_MEDIA_RESOLVE_LIMIT } from "../../src/modules/public-media/public-media.constants.js";
import { PublicMediaRepository } from "../../src/modules/public-media/public-media.repository.js";
import { resolvePublicMediaBodySchema } from "../../src/modules/public-media/public-media.schema.js";
import { PublicMediaService } from "../../src/modules/public-media/public-media.service.js";

/** Builds only the storage method this focused service test exercises. */
function storageStub(createSignedDownload: ObjectStorage["createSignedDownload"]): ObjectStorage {
  return {
    createSignedDownload,
    createSignedUpload: vi.fn(),
    putObject: vi.fn(),
    deleteObject: vi.fn(),
    getObjectMetadata: vi.fn(),
    objectExists: vi.fn(),
  };
}

describe("Public media resolver", () => {
  it("deduplicates requests, omits private IDs, preserves request order, and signs inline URLs", async () => {
    const publicProductFileId = randomUUID();
    const privateFileId = randomUUID();
    const publicStoreFileId = randomUUID();
    const findPublicFilesByIds = vi.fn().mockResolvedValue([
      {
        id: publicStoreFileId,
        objectKey: "store-assets/store-logo.png",
        mimeType: "image/png",
      },
      {
        id: publicProductFileId,
        objectKey: "product-media/product.jpg",
        mimeType: "image/jpeg",
      },
    ]);
    const createSignedDownload = vi.fn(async ({ objectKey }: { objectKey: string }) => ({
      url: `https://media.example.test/${encodeURIComponent(objectKey)}`,
      objectKey,
      expiresAt: new Date("2026-09-20T12:15:00.000Z"),
    }));
    const service = new PublicMediaService({
      repository: { findPublicFilesByIds } as unknown as PublicMediaRepository,
      storage: storageStub(createSignedDownload),
    });

    const result = await service.resolve({
      fileIds: [publicProductFileId, privateFileId, publicProductFileId, publicStoreFileId],
    });

    expect(findPublicFilesByIds).toHaveBeenCalledWith([
      publicProductFileId,
      privateFileId,
      publicStoreFileId,
    ]);
    expect(result.items.map((item) => item.fileId)).toEqual([
      publicProductFileId,
      publicStoreFileId,
    ]);
    expect(createSignedDownload).toHaveBeenNthCalledWith(1, {
      objectKey: "product-media/product.jpg",
    });
    expect(createSignedDownload).toHaveBeenNthCalledWith(2, {
      objectKey: "store-assets/store-logo.png",
    });
    expect(result.items[0]).toMatchObject({
      fileId: publicProductFileId,
      mimeType: "image/jpeg",
      expiresAt: "2026-09-20T12:15:00.000Z",
    });
  });

  it("maps storage signing failures to one safe service-unavailable error", async () => {
    const fileId = randomUUID();
    const service = new PublicMediaService({
      repository: {
        findPublicFilesByIds: vi.fn().mockResolvedValue([
          { id: fileId, objectKey: "product-media/private-key.jpg", mimeType: "image/jpeg" },
        ]),
      } as unknown as PublicMediaRepository,
      storage: storageStub(
        vi.fn().mockRejectedValue(new Error("provider credentials must never escape")),
      ),
    });

    await expect(service.resolve({ fileIds: [fileId] })).rejects.toMatchObject({
      code: ERROR_CODE.SERVICE_UNAVAILABLE,
      statusCode: 503,
      message: "Public media is temporarily unavailable.",
    });
  });

  it("keeps resolver requests bounded by the shared schema limit", () => {
    expect(resolvePublicMediaBodySchema.safeParse({ fileIds: [] }).success).toBe(false);
    expect(
      resolvePublicMediaBodySchema.safeParse({
        fileIds: Array.from({ length: PUBLIC_MEDIA_RESOLVE_LIMIT + 1 }, () => randomUUID()),
      }).success,
    ).toBe(false);
  });
});
