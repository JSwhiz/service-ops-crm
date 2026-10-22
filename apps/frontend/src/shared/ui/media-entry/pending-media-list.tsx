'use client';

import React, { useEffect, useState } from 'react';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';
import styles from './pending-media-list.module.css';

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
  onRename,
  displayNames,
  iconActions = false,
  emptyText = 'Новых вложений пока нет.',
}: {
  files: File[];
  onRemove?: (index: number) => void;
  onRename?: (index: number, name: string) => void;
  displayNames?: Array<string | undefined>;
  iconActions?: boolean;
  emptyText?: string;
}): React.JSX.Element {
  const [imagePreviews, setImagePreviews] = useState<
    Array<{ key: string; url: string }>
  >([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

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
    return emptyText ? <div className="ui-text-muted">{emptyText}</div> : <></>;
  }

  const previewByKey = new Map(
    imagePreviews.map((preview) => [preview.key, preview.url]),
  );

  return (
    <div className="pending-media-list">
      {files.map((file, index) => {
        const key = getPendingFileKey(file, index);
        const previewUrl = previewByKey.get(key);
        const displayName = displayNames?.[index] || file.name;
        const extensionIndex = displayName.lastIndexOf('.');
        const extension = extensionIndex > 0 ? displayName.slice(extensionIndex) : '';
        const baseName = extension ? displayName.slice(0, extensionIndex) : displayName;
        const isEditing = editingIndex === index;

        const saveName = (): void => {
          const trimmed = editingName.trim();
          if (!trimmed || !onRename) return;
          onRename(index, `${trimmed}${extension}`);
          setEditingIndex(null);
        };

        return (
          <div
            key={key}
            className={`pending-media-item${previewUrl ? ' pending-media-item--image' : ''}${iconActions ? ` ${styles.iconActionRow}` : ''}`}
          >
            {previewUrl ? (
              <img src={previewUrl} alt={file.name} />
            ) : (
              <span className="pending-media-item__icon">FILE</span>
            )}
            <div className="pending-media-item__body">
              {isEditing ? (
                <div className={styles.renameField}>
                  <label className={styles.srOnly} htmlFor={`pending-file-name-${index}`}>Название файла</label>
                  <input id={`pending-file-name-${index}`} autoFocus value={editingName} maxLength={160} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveName(); } if (event.key === 'Escape') setEditingIndex(null); }} />
                  {extension ? <span className={styles.extension}>{extension}</span> : null}
                  <button className={styles.iconButton} type="button" onClick={saveName} aria-label="Сохранить название" title="Сохранить"><MediaActionIcon name="check" /></button>
                  <button className={styles.iconButton} type="button" onClick={() => setEditingIndex(null)} aria-label="Отменить переименование" title="Отмена"><MediaActionIcon name="close" /></button>
                </div>
              ) : <strong title={file.name}>{baseName}{extension}</strong>}
              <span>{file.type || 'application/octet-stream'} · {formatFileSize(file.size)}</span>
            </div>

            {iconActions ? (
              <div className={styles.actionGroup}>
                {onRename && !isEditing ? (
                  <button className={styles.iconButton} type="button" onClick={() => { setEditingIndex(index); setEditingName(baseName); }} aria-label={`Изменить название ${displayName}`} title="Изменить название"><MediaActionIcon name="edit" /></button>
                ) : null}
                {onRemove ? <button className={styles.iconButton} type="button" onClick={() => onRemove(index)} aria-label={`Убрать ${displayName}`} title="Убрать"><MediaActionIcon name="trash" /></button> : null}
              </div>
            ) : onRemove ? <button type="button" onClick={() => onRemove(index)}>Убрать</button> : null}
          </div>
        );
      })}
    </div>
  );
}
