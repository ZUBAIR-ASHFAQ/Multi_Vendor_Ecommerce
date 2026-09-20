export interface PublicMediaItem {
  fileId: string;
  url: string;
  mimeType: string;
  expiresAt: string;
}

export interface ResolvePublicMediaInput {
  fileIds: string[];
}

export interface ResolvePublicMediaResponse {
  items: PublicMediaItem[];
}
