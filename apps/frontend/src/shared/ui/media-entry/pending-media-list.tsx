'use client';

import React from 'react';

export function PendingMediaList({
  files,
  onRemove,
  emptyText = 'Новых вложений пока нет.',
}: {
  files: File[];
  onRemove?: (index: number) => void;
  emptyText?: string;
}): React.JSX.Element {
  if (files.length === 0) {
    return <div className="page-muted">{emptyText}</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {files.map((file, index) => (
        <div
          key={`${file.name}-${file.size}-${index}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: 10,
          }}
        >
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
              {file.name}
            </div>
            <div className="page-muted">
              {file.type || 'application/octet-stream'} •{' '}
              {(file.size / 1024).toFixed(1)} КБ
            </div>
          </div>

          {onRemove ? (
            <button type="button" onClick={() => onRemove(index)}>
              Убрать
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
