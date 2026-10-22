'use client';

import React from 'react';

import type { AttachedFile } from '@/entities/file/model/file.types';
import styles from '@/features/object-shared-ui/object-surfaces.module.css';

import { AttachmentPreviewList } from '../media-entry/attachment-preview-list';
import { MediaActionPicker } from '../media-entry/media-action-picker';
import { Surface } from '@/shared/ui/foundation';

export function EntityFilesPanel({
  title,
  files,
  canUpload,
  onUpload,
  emptyText,
  iconOnlyMediaActions = false,
}: {
  title: string;
  files: AttachedFile[];
  canUpload: boolean;
  onUpload: (file: File) => Promise<void>;
  emptyText: string;
  iconOnlyMediaActions?: boolean;
}): React.JSX.Element {
  return (
    <Surface padding="md" className={`${styles.workPanel}`}>
      <div className={styles.panelHeader}>
        <div className="ui-section-title">{title}</div>
        <span className={styles.panelMeta}>{files.length}</span>
      </div>

      {canUpload ? <MediaActionPicker iconOnly={iconOnlyMediaActions} onPick={onUpload} /> : null}

      {files.length === 0 ? (
        <div className={styles.emptyState}>{emptyText}</div>
      ) : (
        <div className="local-scroll local-scroll--sm">
          <AttachmentPreviewList files={files} emptyText={emptyText} />
        </div>
      )}
    </Surface>
  );
}
