"use client";

import { useState } from "react";

import type { Provenance } from "@/lib/contracts/domain";
import type { ColourRole } from "@/lib/contracts/viewModels";
import { ROLE_SHAPE, provenanceBorderStyle } from "@/lib/design/colourRoles";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";

/**
 * `ContentThumbnail` (doc 02 §30).
 *
 * The image slot for anything with artwork: an entity in a search result, a
 * discovered recommendation in the network's inspect panel, a card in the media
 * kit.
 *
 * **A plain `<img>`, not `next/image`.** Qloo image URLs are arbitrary remote
 * hosts discovered at runtime (doc 03 §6: `properties.image.url`), and
 * `next/image` requires every host to be listed in `remotePatterns` — an
 * unlisted one throws during render. Enumerating the CDN hosts a cultural
 * catalogue happens to use is not possible in advance, so the safe build is the
 * one that does not depend on the list being complete. The cost is losing the
 * automatic resizing, which does not matter at these dimensions.
 *
 * **The fallback is a shape, not a gradient.** A broken image is the common case
 * here — hotlinked artwork expires, some entities have none, and synthetic data
 * has no real URLs at all. Filling the slot with a decorative blob would be the
 * "meaningless decorative blob" doc 02 §29 forbids, and worse, it would hide the
 * fact that the artwork is missing. So the fallback draws the role's glyph from
 * the same `ROLE_SHAPE` table the charts use: the empty slot still tells you what
 * kind of thing it was.
 */

export type ThumbnailRatio = "square" | "portrait" | "wide";

export interface ContentThumbnailProps {
  /** Remote artwork URL. Absent or failed → role glyph fallback. */
  src?: string;
  /** Required. An image without alt text is decoration by accident, not by design. */
  alt: string;
  /** Role of the thing depicted, so the fallback glyph matches the charts. */
  role: ColourRole;
  provenance?: Provenance;
  ratio?: ThumbnailRatio;
  /** Pixel size of the longest edge. Layout is driven by `ratio`. */
  size?: number;
  className?: string;
}

export function ContentThumbnail({
  src,
  alt,
  role,
  provenance = "qloo",
  ratio = "square",
  size = 96,
  className,
}: ContentThumbnailProps) {
  // Reset when `src` changes: without this, replacing a broken image with a
  // working one keeps showing the fallback, because `failed` was set for the
  // PREVIOUS url and nothing clears it.
  const [failedFor, setFailedFor] = useState<string | undefined>(undefined);
  const failed = src !== undefined && failedFor === src;
  const showImage = src !== undefined && src.length > 0 && !failed;

  return (
    <span
      className={`cd-thumb cd-thumb--${ratio}${className ? ` ${className}` : ""}`}
      style={{
        // Border style carries provenance (R14), so an illustrative thumbnail is
        // dotted and a retrieved one is solid — visible even with no artwork.
        borderStyle: provenanceBorderStyle(provenance),
        aspectRatio: RATIO[ratio],
        inlineSize: ratio === "portrait" ? undefined : size,
        blockSize: ratio === "wide" ? undefined : size,
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          className="cd-thumb__img"
          loading="lazy"
          decoding="async"
          // Third-party artwork should not learn which creator was being viewed.
          referrerPolicy="no-referrer"
          onError={() => setFailedFor(src)}
        />
      ) : (
        <span className="cd-thumb__fallback" role="img" aria-label={alt}>
          <ShapeGlyph
            shape={ROLE_SHAPE[role] ?? "circle"}
            role={role}
            size={Math.round(size * 0.42)}
            fillOpacity={0.55}
          />
        </span>
      )}
    </span>
  );
}

const RATIO: Record<ThumbnailRatio, string> = {
  square: "1 / 1",
  portrait: "2 / 3",
  wide: "16 / 9",
};
