'use client';

import React from 'react';

import { buildFileDownloadUrl } from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';

export function AttachmentPreviewList({
  files,
  emptyText = 'Вложений пока нет.',
}: {
  files: AttachedFile[];
  emptyText?: string;
}): React.JSX.Element {
  if (files.length === 0) {
    return <div className="page-muted">{emptyText}</div>;
  }

  const imageFiles = files.filter((file) => file.mimeType.startsWith('image/'));
  const regularFiles = files.filter((file) => !file.mimeType.startsWith('image/'));

  return (
    <div className="attachment-preview-stack">
      {imageFiles.length > 0 ? (
        <div
          className={`attachment-image-grid attachment-image-grid--${Math.min(
            imageFiles.length,
            4,
          )}`}
        >
          {imageFiles.map((file) => {
            const url = buildFileDownloadUrl(file.id);

            return (
              <a
                key={file.id}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="attachment-image-card"
              >
                <img src={url} alt={file.originalName} />
                <span>{file.originalName}</span>
              </a>
            );
          })}
        </div>
      ) : null}

      {regularFiles.length > 0 ? (
        <div className="attachment-file-list">
          {regularFiles.map((file) => {
            const url = buildFileDownloadUrl(file.id);

            return (
              <a
                key={file.id}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="attachment-file-card"
              >
                <span className="attachment-file-card__icon">FILE</span>
                <span className="attachment-file-card__body">
                  <strong>{file.originalName}</strong>
                  <span>
                    {file.mimeType} · {(file.sizeBytes / 1024).toFixed(1)} КБ
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
