import { AppError } from "../../common/errors/app-error.js";
import { ERROR_CODE } from "../../common/errors/error-codes.js";
import { S3ObjectStorage } from "../../common/storage/s3-storage.service.js";
import type { ObjectStorage } from "../../common/storage/storage.contract.js";
import { PublicMediaRepository } from "./public-media.repository.js";
import type {
  ResolvePublicMediaInput,
  ResolvePublicMediaResponse,
} from "./public-media.schema.js";

export interface PublicMediaServiceDependencies {
  repository?: PublicMediaRepository;
  storage?: ObjectStorage;
}

/** Public read service that signs only files proven public by the current commerce state. */
export class PublicMediaService {
  private readonly repository: PublicMediaRepository;
  private readonly storage: ObjectStorage;

  /** Uses production repository/storage defaults while allowing explicit test injection. */
  constructor(dependencies: PublicMediaServiceDependencies = {}) {
    this.repository = dependencies.repository ?? new PublicMediaRepository();
    this.storage = dependencies.storage ?? new S3ObjectStorage();
  }

  /**
   * Resolves a bounded batch without revealing whether omitted IDs are missing, private, inactive,
   * unpublished, suspended, or otherwise ineligible for public delivery.
   */
  async resolve(input: ResolvePublicMediaInput): Promise<ResolvePublicMediaResponse> {
    const requestedIds = [...new Set(input.fileIds)];
    const publicFiles = await this.repository.findPublicFilesByIds(requestedIds);
    const publicById = new Map(publicFiles.map((file) => [file.id, file]));

    try {
      const items = await Promise.all(
        requestedIds.flatMap((fileId) => {
          const file = publicById.get(fileId);
          if (!file) return [];
          return [
            this.storage
              .createSignedDownload({ objectKey: file.objectKey })
              .then((signed) => ({
                fileId: file.id,
                url: signed.url,
                mimeType: file.mimeType,
                expiresAt: signed.expiresAt.toISOString(),
              })),
          ];
        }),
      );

      return { items };
    } catch (error) {
      throw new AppError({
        code: ERROR_CODE.SERVICE_UNAVAILABLE,
        message: "Public media is temporarily unavailable.",
        statusCode: 503,
        cause: error,
      });
    }
  }
}
