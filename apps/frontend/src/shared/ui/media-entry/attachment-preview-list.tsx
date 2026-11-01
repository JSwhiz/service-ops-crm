'use client';

import React, { useEffect, useRef, useState } from 'react';

import {
  buildFileDownloadUrl,
  buildFileViewerUrl,
  getFileView,
  resolveFileApiUrl,
  retryFilePreview,
} from '@/entities/file/api/file-client';
import type {
  FilePreviewItem,
  FileView,
} from '@/entities/file/model/file.types';
import { Button } from '@/shared/ui/foundation';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';
import { FileViewer } from './file-viewer';
import { formatFileTypeLabel } from './file-viewer-presentation';
import compactStyles from './attachment-preview-list.module.css';
import mediaStyles from '@/shared/ui/media-entry/media-entry.module.css';

const PREVIEW_POLL_ATTEMPTS = 40;
const COMPACT_VISIBLE_LIMIT = 4;

function formatFileSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function getFileTypeLabel(file: FilePreviewItem): string {
  const extension = file.originalName.split('.').pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : 'FILE';
}

function AttachmentPreviewCard({
  file,
  compact = false,
  renderFileAction,
  getFileActions,
  getFileState,
  onOpenGallery,
}: {
  file: FilePreviewItem;
  compact?: boolean;
  renderFileAction?: (file: FilePreviewItem) => React.ReactNode;
  getFileActions?: (file: FilePreviewItem) => ReadonlyArray<OverflowMenuItem>;
  getFileState?: (file: FilePreviewItem) => 'pending-removal' | null | undefined;
  onOpenGallery: (fileId: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<FileView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pollingRun, setPollingRun] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const actionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewerUrl = buildFileViewerUrl(file.id);
  const downloadUrl = buildFileDownloadUrl(file.id);
  const fileState = getFileState?.(file);
  const fileActions: OverflowMenuItem[] = [
    { key: 'open', label: 'Открыть', onSelect: () => onOpenGallery(file.id) },
    ...(getFileActions?.(file) ?? []),
    { key: 'download', label: 'Скачать', onSelect: () => { window.location.assign(downloadUrl); } },
  ];

  const openContextActions = (event: React.MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    if (actionsTriggerRef.current?.getAttribute('aria-expanded') !== 'true') {
      actionsTriggerRef.current?.click();
    }
  };
  const openKeyboardActions = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.shiftKey && event.key === 'F10') {
      event.preventDefault();
      if (actionsTriggerRef.current?.getAttribute('aria-expanded') !== 'true') {
        actionsTriggerRef.current?.click();
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;

    const load = async (): Promise<void> => {
      try {
        const nextView = await getFileView(file.id);

        if (cancelled) {
          return;
        }

        setView(nextView);
        setLoadFailed(false);

        if (
          (nextView.previewStatus === 'pending' ||
            nextView.previewStatus === 'processing') &&
          attempts < PREVIEW_POLL_ATTEMPTS
        ) {
          attempts += 1;
          timeoutId = window.setTimeout(() => void load(), 1500);
        }
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [file.id, pollingRun]);

  const handleRetry = async (): Promise<void> => {
    setIsRetrying(true);
    setLoadFailed(false);

    try {
      setView(await retryFilePreview(file.id));
      setPollingRun((current) => current + 1);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsRetrying(false);
    }
  };

  const isImage = view?.previewType === 'image';
  const thumbnailUrl = view?.thumbnailUrl
    ? resolveFileApiUrl(view.thumbnailUrl)
    : null;
  const originalInlineUrl = resolveFileApiUrl(
    `/api/v1/files/${file.id}/content`,
  );

  if (isImage) {
    return (
      <div className={`attachment-image-card-shell${compact ? ` ${compactStyles.compactImageShell}` : ''}`} onContextMenu={openContextActions} onKeyDown={openKeyboardActions}>
        <a
          href={viewerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`attachment-image-card${compact ? ` ${compactStyles.compactImage}` : ''}`}
          aria-label={`Открыть ${file.originalName}`}
          title={file.originalName}
          onClick={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onOpenGallery(file.id);
            }
          }}
        >
          {thumbnailUrl ? (
            <img
              className={fileState === 'pending-removal' ? compactStyles.pendingRemovalImage : undefined}
              width={320}
              height={180}
              loading="lazy"
              decoding="async"
              src={thumbnailFailed ? originalInlineUrl : thumbnailUrl}
              alt={file.originalName}
              onError={() => setThumbnailFailed(true)}
            />
          ) : (
            <span className={mediaStyles.attachmentPreviewSkeleton}>
              {view?.previewStatus === 'failed'
                ? 'Предпросмотр недоступен'
                : 'Формируется превью…'}
            </span>
          )}
        </a>
        {!compact ? <span className={compactStyles.compactFilename} title={file.originalName}>{file.originalName}</span> : null}
        {renderFileAction ? <div className={compactStyles.legacyAction}>{renderFileAction(file)}</div> : null}
        <div className={mediaStyles.previewActionGroup}>
          <OverflowMenu items={fileActions} triggerLabel={`Действия с файлом: ${file.originalName}`} triggerRef={actionsTriggerRef} />
        </div>
        {fileState === 'pending-removal' ? <span className={compactStyles.fileState} role="status">Ожидает удаления</span> : null}
        {view?.previewStatus === 'failed' &&
        view.previewType !== 'unsupported' ? (
          <button
            type="button"
            disabled={isRetrying}
            onClick={() => void handleRetry()}
          >
            {isRetrying ? 'Повторяем…' : 'Повторить'}
          </button>
        ) : null}
      </div>
    );
  }

  const statusText = loadFailed
    ? 'Статус предпросмотра недоступен'
    : view?.previewStatus === 'pending' || view?.previewStatus === 'processing'
      ? 'Предпросмотр формируется'
      : view?.previewStatus === 'failed'
        ? 'Предпросмотр недоступен'
        : view?.previewType === 'unsupported'
          ? 'Только скачивание'
          : view?.previewStatus === 'ready'
            ? 'Предпросмотр'
            : 'Проверяем формат…';

  return (
    <div className="attachment-file-card" onContextMenu={openContextActions} onKeyDown={openKeyboardActions}>
      <a
        href={viewerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="attachment-file-card__open"
      >
        <span className={mediaStyles.attachmentFileCardIcon}>
          {getFileTypeLabel(file)}
        </span>
        <span className="attachment-file-card__body">
          <strong title={file.originalName}>{file.originalName}</strong>
          <span>
            {formatFileTypeLabel(file)} ·{' '}
            {formatFileSize(file.sizeBytes)}
          </span>
          <span>{statusText}</span>
        </span>
      </a>
      <div className="attachment-file-card__actions">
        {renderFileAction?.(file)}
        <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
          Открыть
        </a>
        <OverflowMenu items={fileActions} triggerLabel={`Действия с файлом: ${file.originalName}`} triggerRef={actionsTriggerRef} />
        {view?.previewStatus === 'failed' &&
        view.previewType !== 'unsupported' ? (
          <button
            type="button"
            disabled={isRetrying}
            onClick={() => void handleRetry()}
          >
            {isRetrying ? 'Повторяем…' : 'Повторить'}
          </button>
        ) : null}
      </div>
      {fileState === 'pending-removal' ? <span className={compactStyles.fileState} role="status">Ожидает удаления</span> : null}
    </div>
  );
}

export function AttachmentPreviewList({
  files,
  emptyText = 'Вложений пока нет.',
  compact = true,
  renderFileAction,
  getFileActions,
  getFileState,
}: {
  files: FilePreviewItem[];
  emptyText?: string;
  /** Kept for source compatibility; downloads now live in the per-file menu. */
  iconDownload?: boolean;
  compactMetadata?: boolean;
  /** Limit the initial preview, retaining access to every attachment. */
  compact?: boolean;
  renderFileAction?: (file: FilePreviewItem) => React.ReactNode;
  getFileActions?: (file: FilePreviewItem) => ReadonlyArray<OverflowMenuItem>;
  getFileState?: (file: FilePreviewItem) => 'pending-removal' | null | undefined;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const listId = React.useId();
  if (files.length === 0) {
    return <div className="ui-text-muted">{emptyText}</div>;
  }

  const visibleFiles = compact && !expanded ? files.slice(0, COMPACT_VISIBLE_LIMIT) : files;
  const imageFiles = visibleFiles.filter(
    (file) =>
      file.mimeType.startsWith('image/') && file.mimeType !== 'image/svg+xml',
  );
  const regularFiles = visibleFiles.filter((file) => !imageFiles.includes(file));

  return (
    <div className={`attachment-preview-stack${compact ? ` ${compactStyles.compactList}` : ''}`}>
      <div id={`${listId}-files`}>
      {imageFiles.length > 0 ? (
        <div
          className={`attachment-image-grid attachment-image-grid--${Math.min(
            imageFiles.length,
            4,
          )}`}
        >
          {imageFiles.map((file) => (
            <AttachmentPreviewCard
              key={file.id}
              file={file}
              compact={compact}
              renderFileAction={renderFileAction}
              getFileActions={getFileActions}
              getFileState={getFileState}
              onOpenGallery={setActiveFileId}
            />
          ))}
        </div>
      ) : null}

      {regularFiles.length > 0 ? (
        <div className="attachment-file-list">
          {regularFiles.map((file) => (
            <AttachmentPreviewCard
              key={file.id}
              file={file}
              compact={compact}
              renderFileAction={renderFileAction}
              getFileActions={getFileActions}
              getFileState={getFileState}
              onOpenGallery={setActiveFileId}
            />
          ))}
        </div>
      ) : null}
      </div>
      {compact && files.length > COMPACT_VISIBLE_LIMIT ? <Button id={`${listId}-disclosure`} className={compactStyles.expandButton} variant="ghost" aria-expanded={expanded} aria-controls={`${listId}-files`} onClick={() => setExpanded((value) => !value)}>
        {expanded ? 'Свернуть вложения' : `Показать все вложения (${files.length})`}
      </Button> : null}
      {activeFileId ? <FileViewer fileId={activeFileId} files={files} onClose={() => setActiveFileId(null)} /> : null}
    </div>
  );
}
