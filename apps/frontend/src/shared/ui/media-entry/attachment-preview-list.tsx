'use client';

import React, { useEffect, useState } from 'react';

import {
  buildFileDownloadUrl,
  buildFileViewerUrl,
  getFileView,
  resolveFileApiUrl,
  retryFilePreview,
} from '@/entities/file/api/file-client';
import type { AttachedFile, FileView } from '@/entities/file/model/file.types';

const PREVIEW_POLL_ATTEMPTS = 40;

function formatFileSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function getFileTypeLabel(file: AttachedFile): string {
  const extension = file.originalName.split('.').pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : 'FILE';
}

function AttachmentPreviewCard({ file }: { file: AttachedFile }): React.JSX.Element {
  const [view, setView] = useState<FileView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pollingRun, setPollingRun] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);

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

  const viewerUrl = buildFileViewerUrl(file.id);
  const downloadUrl = buildFileDownloadUrl(file.id);
  const isImage = view?.previewType === 'image';
  const thumbnailUrl = view?.thumbnailUrl
    ? resolveFileApiUrl(view.thumbnailUrl)
    : null;

  if (isImage) {
    return (
      <div className="attachment-image-card-shell">
        <a
          href={viewerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="attachment-image-card"
          aria-label={`Открыть ${file.originalName}`}
        >
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={file.originalName} />
          ) : (
            <span className="attachment-preview-skeleton">
              {view?.previewStatus === 'failed'
                ? 'Предпросмотр недоступен'
                : 'Формируется превью…'}
            </span>
          )}
          <span title={file.originalName}>{file.originalName}</span>
        </a>
        <a
          href={downloadUrl}
          className="attachment-download-link"
          aria-label={`Скачать ${file.originalName}`}
        >
          Скачать
        </a>
        {view?.previewStatus === 'failed' && view.previewType !== 'unsupported' ? (
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
          : 'Можно открыть в браузере';

  return (
    <div className="attachment-file-card">
      <a
        href={viewerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="attachment-file-card__open"
      >
        <span className="attachment-file-card__icon">
          {getFileTypeLabel(file)}
        </span>
        <span className="attachment-file-card__body">
          <strong title={file.originalName}>{file.originalName}</strong>
          <span>
            {file.mimeType} · {formatFileSize(file.sizeBytes)}
          </span>
          <span>{statusText}</span>
        </span>
      </a>
      <span className="attachment-file-card__actions">
        <a href={viewerUrl} target="_blank" rel="noopener noreferrer">
          Открыть
        </a>
        <a href={downloadUrl}>Скачать</a>
        {view?.previewStatus === 'failed' && view.previewType !== 'unsupported' ? (
          <button
            type="button"
            disabled={isRetrying}
            onClick={() => void handleRetry()}
          >
            {isRetrying ? 'Повторяем…' : 'Повторить'}
          </button>
        ) : null}
      </span>
    </div>
  );
}

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

  const imageFiles = files.filter(
    (file) =>
      file.mimeType.startsWith('image/') && file.mimeType !== 'image/svg+xml',
  );
  const regularFiles = files.filter((file) => !imageFiles.includes(file));

  return (
    <div className="attachment-preview-stack">
      {imageFiles.length > 0 ? (
        <div
          className={`attachment-image-grid attachment-image-grid--${Math.min(
            imageFiles.length,
            4,
          )}`}
        >
          {imageFiles.map((file) => (
            <AttachmentPreviewCard key={file.id} file={file} />
          ))}
        </div>
      ) : null}

      {regularFiles.length > 0 ? (
        <div className="attachment-file-list">
          {regularFiles.map((file) => (
            <AttachmentPreviewCard key={file.id} file={file} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
