'use client';

import React from 'react';

import type { AttachedFile } from '@/entities/file/model/file.types';

import { AttachmentPreviewList } from '../media-entry/attachment-preview-list';
import { MediaActionPicker } from '../media-entry/media-action-picker';

export function EntityFilesPanel({
  title,
  files,
  canUpload,
  onUpload,
  emptyText,
}: {
  title: string;
  files: AttachedFile[];
  canUpload: boolean;
  onUpload: (file: File) => Promise<void>;
  emptyText: string;
}): React.JSX.Element {
  return (
    <div className="page-card" style={{ display: 'grid', gap: 16 }}>
      <div className="section-header">
        <div>
          <div className="section-title">{title}</div>
          <div className="section-subtitle">
            Файлы открываются через backend proxy.
          </div>
        </div>
      </div>

      {canUpload ? <MediaActionPicker onPick={onUpload} /> : null}

      <div className="local-scroll local-scroll--sm">
        <AttachmentPreviewList files={files} emptyText={emptyText} />
      </div>
    </div>
  );
}
