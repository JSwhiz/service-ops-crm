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

  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}
    >
      {files.map((file) => {
        const url = buildFileDownloadUrl(file.id);
        const isImage = file.mimeType.startsWith('image/');

        return (
          <a
            key={file.id}
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 10,
              color: 'inherit',
              textDecoration: 'none',
              display: 'grid',
              gap: 8,
            }}
          >
            {isImage ? (
              <img
                src={url}
                alt={file.originalName}
                style={{
                  width: '100%',
                  height: 140,
                  objectFit: 'cover',
                  borderRadius: 8,
                  background: '#f3f4f6',
                }}
              />
            ) : (
              <div
                style={{
                  minHeight: 140,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 8,
                  background: '#f3f4f6',
                  color: '#6b7280',
                  textAlign: 'center',
                  padding: 12,
                }}
              >
                Файл
              </div>
            )}

            <div>
              <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                {file.originalName}
              </div>
              <div className="page-muted">
                {(file.sizeBytes / 1024).toFixed(1)} КБ
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
