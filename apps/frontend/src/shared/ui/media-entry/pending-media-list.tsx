'use client';

import React, { useEffect, useState } from 'react';

function formatFileSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function getPendingFileKey(file: File, index: number): string {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

export function PendingMediaList({
  files,
  onRemove,
  emptyText = 'Новых вложений пока нет.',
}: {
  files: File[];
  onRemove?: (index: number) => void;
  emptyText?: string;
}): React.JSX.Element {
  const [imagePreviews, setImagePreviews] = useState<
    Array<{ key: string; url: string }>
  >([]);

  useEffect(() => {
    const previews = files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => file.type.startsWith('image/'))
      .map(({ file, index }) => ({
        key: getPendingFileKey(file, index),
        url: URL.createObjectURL(file),
      }));

    setImagePreviews(previews);

    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [files]);

  if (files.length === 0) {
    return <div className="page-muted">{emptyText}</div>;
  }

  const previewByKey = new Map(
    imagePreviews.map((preview) => [preview.key, preview.url]),
  );

  return (
    <div className="pending-media-list">
      {files.map((file, index) => {
        const key = getPendingFileKey(file, index);
        const previewUrl = previewByKey.get(key);

        return (
          <div
            key={key}
            className={`pending-media-item${previewUrl ? ' pending-media-item--image' : ''}`}
          >
            {previewUrl ? (
              <img src={previewUrl} alt={file.name} />
            ) : (
              <span className="pending-media-item__icon">FILE</span>
            )}
            <div className="pending-media-item__body">
              <strong>{file.name}</strong>
              <span>
                {file.type || 'application/octet-stream'} · {formatFileSize(file.size)}
              </span>
            </div>

            {onRemove ? (
              <button type="button" onClick={() => onRemove(index)}>
                Убрать
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
