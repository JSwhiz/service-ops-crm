'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import {
  getFileView,
  resolveFileApiUrl,
  retryFilePreview,
} from '@/entities/file/api/file-client';
import type { FileView } from '@/entities/file/model/file.types';
import { Button, Surface } from '@/shared/ui/foundation';
import viewerStyles from '@/app/(app)/files/[fileId]/view/file-viewer.module.css';

const VIEW_POLL_ATTEMPTS = 40;

function formatFileSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

export default function FileViewerPage(): React.JSX.Element {
  const params = useParams<{ fileId: string }>();
  const fileId = params.fileId;
  const [view, setView] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [textTruncated, setTextTruncated] = useState(false);
  const [showOriginalSize, setShowOriginalSize] = useState(false);
  const [useOriginalImage, setUseOriginalImage] = useState(false);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [pollingRun, setPollingRun] = useState(0);

  const loadView = useCallback(async (): Promise<FileView> => {
    const nextView = await getFileView(fileId);
    setView(nextView);
    setError(null);
    return nextView;
  }, [fileId]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;

    const load = async (): Promise<void> => {
      try {
        const nextView = await loadView();

        if (cancelled) {
          return;
        }

        if (
          nextView.previewStatus === 'pending' ||
          nextView.previewStatus === 'processing'
        ) {
          if (attempts >= VIEW_POLL_ATTEMPTS) {
            setPollTimedOut(true);
            return;
          }

          attempts += 1;
          timeoutId = window.setTimeout(() => void load(), 1500);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Не удалось открыть файл.',
          );
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
  }, [loadView, pollingRun]);

  useEffect(() => {
    if (
      !view?.inlineContentUrl ||
      view.previewType !== 'text' ||
      view.previewStatus !== 'ready'
    ) {
      return;
    }

    let cancelled = false;
    const loadText = async (): Promise<void> => {
      try {
        const response = await fetch(resolveFileApiUrl(view.inlineContentUrl!), {
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`Preview request failed with status ${response.status}`);
        }

        const content = await response.text();

        if (!cancelled) {
          setTextPreview(content);
          setTextTruncated(response.headers.get('X-Content-Truncated') === '1');
        }
      } catch (previewError) {
        if (!cancelled) {
          setError(
            previewError instanceof Error
              ? previewError.message
              : 'Не удалось загрузить текстовый предпросмотр.',
          );
        }
      }
    };

    void loadText();

    return () => {
      cancelled = true;
    };
  }, [view]);

  const handleRetry = async (): Promise<void> => {
    setError(null);
    setPollTimedOut(false);

    try {
      setView(await retryFilePreview(fileId));
      setPollingRun((current) => current + 1);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : 'Не удалось повторить формирование предпросмотра.',
      );
    }
  };

  if (error && !view) {
    return <Surface padding="md" className={viewerStyles.fileViewerError}>{error}</Surface>;
  }

  if (!view) {
    return <Surface padding="md" className={viewerStyles.fileViewerLoading}>Загрузка файла…</Surface>;
  }

  const inlineUrl = view.inlineContentUrl
    ? resolveFileApiUrl(view.inlineContentUrl)
    : null;
  const downloadUrl = resolveFileApiUrl(view.downloadUrl);
  const isWaiting =
    view.previewStatus === 'pending' || view.previewStatus === 'processing';

  return (
    <main className={viewerStyles.fileViewerPage}>
      <header className={viewerStyles.fileViewerHeader}>
        <div>
          <h1 title={view.originalName}>{view.originalName}</h1>
          <p>
            {view.mimeType} · {formatFileSize(view.sizeBytes)}
          </p>
        </div>
        <div className="ui-inline">
          {view.previewType === 'image' && inlineUrl ? (
            <Button
              onClick={() => setShowOriginalSize((current) => !current)}
            >
              {showOriginalSize ? 'Вписать в экран' : 'Оригинальный размер'}
            </Button>
          ) : null}
          <a className="ui-button" href={downloadUrl}>
            Скачать оригинал
          </a>
        </div>
      </header>

      <section className={viewerStyles.fileViewerStage} aria-live="polite">
        {isWaiting ? (
          <div className={viewerStyles.fileViewerState}>
            <strong>Предпросмотр документа формируется…</strong>
            {pollTimedOut ? (
              <Button
                onClick={() => {
                  setPollTimedOut(false);
                  setPollingRun((current) => current + 1);
                }}
              >
                Обновить статус
              </Button>
            ) : (
              <span>Статус обновится автоматически.</span>
            )}
          </div>
        ) : null}

        {view.previewStatus === 'failed' ? (
          <div className={viewerStyles.fileViewerState}>
            <strong>Не удалось сформировать предпросмотр документа</strong>
            <span>{view.errorMessage || 'Предпросмотр недоступен.'}</span>
            {view.previewType !== 'unsupported' ? (
              <Button onClick={() => void handleRetry()}>
                Повторить
              </Button>
            ) : null}
          </div>
        ) : null}

        {view.previewStatus === 'ready' && view.previewType === 'image' && inlineUrl && !imageUnavailable ? (
          <div
            className={`${viewerStyles.fileViewerImage}${
              showOriginalSize ? ` ${viewerStyles.fileViewerImageOriginal}` : ''
            }`}
          >
            <img
              src={useOriginalImage ? resolveFileApiUrl(`/api/v1/files/${view.id}/content`) : inlineUrl}
              alt={view.originalName}
              onError={() => {
                if (!useOriginalImage) setUseOriginalImage(true);
                else setImageUnavailable(true);
              }}
            />
          </div>
        ) : null}

        {imageUnavailable ? (
          <div className={viewerStyles.fileViewerState}>
            <strong>Не удалось открыть изображение</strong>
            <span>Оригинал файла также недоступен для просмотра. Попробуйте скачать его.</span>
          </div>
        ) : null}

        {view.previewStatus === 'ready' && view.previewType === 'pdf' && inlineUrl ? (
          <iframe
            className={viewerStyles.fileViewerPdf}
            src={inlineUrl}
            title={`Предпросмотр ${view.originalName}`}
          />
        ) : null}

        {view.previewStatus === 'ready' && view.previewType === 'text' ? (
          <div className={viewerStyles.fileViewerText}>
            {textTruncated ? (
              <p>Показаны первые 512 КБ файла.</p>
            ) : null}
            <pre>{textPreview ?? 'Загрузка текста…'}</pre>
          </div>
        ) : null}
      </section>
    </main>
  );
}
