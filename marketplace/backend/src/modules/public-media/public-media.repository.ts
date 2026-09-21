import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../database/db.js";
import {
  files,
  productMedia,
  products,
  sellers,
  stores,
} from "../../database/schema/index.js";
import type { DatabaseExecutor } from "../../database/types.js";
import { DOCUMENT_FILE_STATUS, DOCUMENT_PURPOSE } from "../documents-audit/documents-audit.constants.js";
import {
  PRODUCT_PUBLICATION_STATUS,
  PRODUCT_STATUS,
} from "../products/products.constants.js";
import {
  SELLER_APPROVAL_STATUS,
  SELLER_STATUS,
  STORE_STATUS,
} from "../sellers/sellers.constants.js";

/** Storage metadata needed after the repository has proven that one file is publicly visible. */
export interface PublicMediaFileRecord {
  id: string;
  objectKey: string;
  mimeType: string;
}

/**
 * Read-only public-media projection. It is deliberately separate from Documents so the private
 * document repository does not acquire reverse dependencies on Product/Store persistence.
 */
export class PublicMediaRepository {
  /** Uses the shared database executor by default while allowing transaction/test injection. */
  constructor(private readonly executor: DatabaseExecutor = db) {}

  /** Returns only confirmed Product-media files attached to a currently public Product source. */
  private async findPublicProductMediaFiles(
    fileIds: readonly string[],
  ): Promise<PublicMediaFileRecord[]> {
    if (fileIds.length === 0) return [];

    return this.executor
      .select({ id: files.id, objectKey: files.objectKey, mimeType: files.mimeType })
      .from(files)
      .innerJoin(productMedia, eq(productMedia.fileId, files.id))
      .innerJoin(products, eq(products.id, productMedia.productId))
      .innerJoin(stores, eq(stores.id, products.storeId))
      .innerJoin(sellers, eq(sellers.id, products.sellerId))
      .where(
        and(
          inArray(files.id, [...fileIds]),
          eq(files.status, DOCUMENT_FILE_STATUS.CONFIRMED),
          eq(files.purpose, DOCUMENT_PURPOSE.PRODUCT_MEDIA),
          eq(productMedia.status, PRODUCT_STATUS.ACTIVE),
          eq(products.status, PRODUCT_STATUS.ACTIVE),
          eq(products.publicationStatus, PRODUCT_PUBLICATION_STATUS.PUBLISHED),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      );
  }

  /** Returns only confirmed Store assets used as the logo of a currently public Store source. */
  private async findPublicStoreAssets(
    fileIds: readonly string[],
  ): Promise<PublicMediaFileRecord[]> {
    if (fileIds.length === 0) return [];

    return this.executor
      .select({ id: files.id, objectKey: files.objectKey, mimeType: files.mimeType })
      .from(files)
      .innerJoin(stores, eq(stores.logoFileId, files.id))
      .innerJoin(sellers, eq(sellers.id, stores.sellerId))
      .where(
        and(
          inArray(files.id, [...fileIds]),
          eq(files.status, DOCUMENT_FILE_STATUS.CONFIRMED),
          eq(files.purpose, DOCUMENT_PURPOSE.STORE_ASSET),
          eq(stores.status, STORE_STATUS.ACTIVE),
          eq(sellers.status, SELLER_STATUS.ACTIVE),
          eq(sellers.approvalStatus, SELLER_APPROVAL_STATUS.APPROVED),
        ),
      );
  }

  /**
   * Resolves only files whose current Product/Store relationships make them public. Duplicates are
   * collapsed because one physical file may legitimately be referenced by more than one public row.
   */
  async findPublicFilesByIds(fileIds: readonly string[]): Promise<PublicMediaFileRecord[]> {
    const [productFiles, storeFiles] = await Promise.all([
      this.findPublicProductMediaFiles(fileIds),
      this.findPublicStoreAssets(fileIds),
    ]);

    return [...new Map([...productFiles, ...storeFiles].map((file) => [file.id, file])).values()];
  }
}
