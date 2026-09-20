import { useMemo, useState } from "react";
import type { PublicMediaItem } from "@/features/public-media/types/public-media.types";
import type { PublicProductMedia } from "../types/products.types";

/** Product media gallery with one focused stage and accessible thumbnail selection. */
export function PublicProductGallery({
  productName,
  media,
  resolvedMedia,
}: {
  productName: string;
  media: PublicProductMedia[];
  resolvedMedia: PublicMediaItem[];
}) {
  const ordered = useMemo(
    () => [...media].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
    [media],
  );
  const resolvedById = useMemo(
    () => new Map(resolvedMedia.map((item) => [item.fileId, item])),
    [resolvedMedia],
  );
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const selected = ordered.find((item) => item.id === selectedMediaId) ?? ordered[0];
  const selectedResolved = selected ? resolvedById.get(selected.fileId) : undefined;
  const selectedLabel = selected?.altText ?? productName;

  return (
    <section className="product-detail-gallery" aria-label={`${productName} media gallery`}>
      <div className="product-detail-gallery-stage">
        {selected && selectedResolved && selected.mediaType === "image" ? (
          <img src={selectedResolved.url} alt={selectedLabel} />
        ) : selected && selectedResolved && selected.mediaType === "video" ? (
          <video src={selectedResolved.url} controls preload="metadata" aria-label={selectedLabel} />
        ) : (
          <div className="product-detail-gallery-empty" role="img" aria-label={`${productName} image unavailable`}>
            <span aria-hidden="true">◇</span>
            <p>Product media unavailable</p>
          </div>
        )}
      </div>

      {ordered.length > 1 ? (
        <div className="product-detail-thumbnails" aria-label="Choose product media">
          {ordered.map((item, index) => {
            const resolved = resolvedById.get(item.fileId);
            const label = item.altText ?? `${productName} media ${index + 1}`;
            const active = item.id === selected?.id;
            return (
              <button
                key={item.id}
                type="button"
                className={active ? "is-active" : undefined}
                aria-label={`Show ${label}`}
                aria-pressed={active}
                onClick={() => setSelectedMediaId(item.id)}
              >
                {resolved?.mimeType.startsWith("image/") ? (
                  <img src={resolved.url} alt="" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">{item.mediaType === "video" ? "▶" : "◇"}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
