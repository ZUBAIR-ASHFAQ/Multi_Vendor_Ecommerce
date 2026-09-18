export interface SignedUploadRequest {
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
  contentLength?: number;
}


export interface StoredObjectWriteRequest {
  objectKey: string;
  contentType: string;
  body: Uint8Array;
}

export interface SignedDownloadRequest {
  objectKey: string;
  expiresInSeconds?: number;
  downloadFileName?: string;
}

export interface SignedUrlResult {
  url: string;
  objectKey: string;
  expiresAt: Date;
}

/** Provider-neutral metadata returned by a storage HEAD/stat request. */
export interface StoredObjectMetadata {
  contentType: string | null;
  contentLength: number | null;
  checksum: string | null;
}

/** Storage abstraction used by business modules; database rows store keys, never blobs. */
export interface ObjectStorage {
  createSignedUpload(request: SignedUploadRequest): Promise<SignedUrlResult>;
  putObject(request: StoredObjectWriteRequest): Promise<StoredObjectMetadata>;
  createSignedDownload(request: SignedDownloadRequest): Promise<SignedUrlResult>;
  deleteObject(objectKey: string): Promise<void>;
  getObjectMetadata(objectKey: string): Promise<StoredObjectMetadata | null>;
  objectExists(objectKey: string): Promise<boolean>;
}
