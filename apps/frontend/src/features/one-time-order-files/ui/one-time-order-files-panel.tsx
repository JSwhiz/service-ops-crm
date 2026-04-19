'use client';

import React from 'react';

import type { AttachedFile } from '@/entities/file/model/file.types';
import { EntityFilesPanel } from '@/shared/ui/entity-files/entity-files-panel';

export function OneTimeOrderFilesPanel({
  files,
  canUpload,
  onUpload,
}: {
  files: AttachedFile[];
  canUpload: boolean;
  onUpload: (file: File) => Promise<void>;
}): React.JSX.Element {
  return (
    <EntityFilesPanel
      title="Файлы заказа"
      files={files}
      canUpload={canUpload}
      onUpload={onUpload}
      emptyText="Файлы по заказу пока не загружены."
    />
  );
}
