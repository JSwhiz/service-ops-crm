'use client';

import React, { useState } from 'react';

import {
  buildFileDownloadUrl,
} from '@/entities/file/api/file-client';
import type { AttachedFile } from '@/entities/file/model/file.types';

export function OneTimeOrderFilesPanel({
  files,
  canUpload,
  onUpload,
}: {
  files: AttachedFile[];
  canUpload: boolean;
  onUpload: (file: File) => Promise<void>;
}): React.JSX.Element {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div style={{ fontWeight: 600 }}>Файлы</div>

      {canUpload ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();

            if (!selectedFile) {
              return;
            }

            setIsSubmitting(true);
            try {
              await onUpload(selectedFile);
              setSelectedFile(null);
              const input = event.currentTarget.elements.namedItem(
                'one-time-order-file',
              ) as HTMLInputElement | null;

              if (input) {
                input.value = '';
              }
            } finally {
              setIsSubmitting(false);
            }
          }}
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            name="one-time-order-file"
            type="file"
            onChange={(event) =>
              setSelectedFile(event.target.files?.[0] ?? null)
            }
          />
          <button type="submit" disabled={!selectedFile || isSubmitting}>
            {isSubmitting ? 'Загружаем...' : 'Загрузить файл'}
          </button>
        </form>
      ) : null}

      {files.length === 0 ? (
        <div className="page-muted">Файлы по заказу пока не загружены.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {files.map((file) => (
            <a
              key={file.id}
              href={buildFileDownloadUrl(file.id)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: 10,
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <span>{file.originalName}</span>
              <span className="page-muted">
                {(file.sizeBytes / 1024).toFixed(1)} КБ
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
