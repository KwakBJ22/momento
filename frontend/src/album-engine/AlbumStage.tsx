import { useEffect, useState } from "react";

import type { AlbumCategory, AlbumPhoto } from "../types";

import AlbumRenderer from "./AlbumRenderer";

import type { BuiltAlbum } from "./buildAlbum";

import { buildAlbum, ensureOrientation } from "./buildAlbum";
import { selectAlbumPhotoUrl } from "../lib/imageUrls";
import type { EnginePhoto, LocationSource } from "./types";



interface AlbumStageProps {

  photos: AlbumPhoto[];

  title: string;

  epilogue?: string | null;

  fallbackImageUrl?: string;

  coverDateLabel?: string | null;

  category?: AlbumCategory | string | null;

  albumId?: string | null;

  onBuilt?: (album: BuiltAlbum) => void;

}



/** @deprecated AlbumRenderer 사용 권장 */

export default function AlbumStage(props: AlbumStageProps) {

  const { onBuilt, ...rendererProps } = props;

  const [built, setBuilt] = useState<BuiltAlbum | null>(null);



  useEffect(() => {

    if (!props.photos.length) return;

    const ordered = props.photos.map(toEnginePhoto);

    const album = buildAlbum(ordered, {

      title: props.title,

      epilogue: props.epilogue ?? null,

      category: props.category,

      coverDateLabel: props.coverDateLabel,

      albumId: props.albumId,

    });

    setBuilt(album);

    onBuilt?.(album);

  }, [props.photos, props.title, props.epilogue, props.category, props.coverDateLabel, props.albumId, onBuilt]);



  useEffect(() => {

    if (built) onBuilt?.(built);

  }, [built, onBuilt]);



  return <AlbumRenderer {...rendererProps} mode="screen" />;

}



function toEnginePhoto(photo: AlbumPhoto): EnginePhoto {

  const width = photo.width ?? null;

  const height = photo.height ?? null;

  return {

    id: photo.id,

    src: selectAlbumPhotoUrl(photo, "screen"),
    alt: photo.caption || undefined,

    width,

    height,

    orientation: ensureOrientation(width, height, photo.orientation),

    comment: photo.caption,

    comments: photo.comments ?? undefined,

    authorLabel: photo.author_label ?? null,

    sortOrder: photo.sort_order,

    takenAt: photo.taken_at ?? null,

    latitude: photo.latitude ?? null,

    longitude: photo.longitude ?? null,

    locationName: photo.location_name ?? null,

    locationSource: (photo.location_source as LocationSource | null) ?? null,

  };

}


