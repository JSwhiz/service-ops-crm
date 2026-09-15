'use client';

import React from 'react';

import type { AttachedFile } from '@/entities/file/model/file.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';

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
    <div className={`page-card ${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="section-title">{title}</div>
        <span className={styles.panelMeta}>{files.length}</span>
      </div>

      {canUpload ? <MediaActionPicker onPick={onUpload} /> : null}

      {files.length === 0 ? (
        <div className={styles.emptyState}>{emptyText}</div>
      ) : (
        <div className="local-scroll local-scroll--sm">
          <AttachmentPreviewList files={files} emptyText={emptyText} />
        </div>
      )}
    </div>
  );
}
