'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  getFileView,
  resolveFileApiUrl,
  retryFilePreview,
} from '@/entities/file/api/file-client';
import type { FilePreviewItem, FileView } from '@/entities/file/model/file.types';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';
import { Button, IconButton } from '@/shared/ui/foundation';
import { Dialog } from '@/shared/ui/overlays/overlays';
import { ChevronLeftIcon, ChevronRightIcon, FitToScreenIcon, OneToOneIcon, SearchIcon } from '@/shared/ui/icons/icons';
import { getLensGeometry, type LensGeometry } from './file-viewer-geometry';
import styles from './file-viewer.module.css';

const VIEW_POLL_ATTEMPTS = 40;
const ORIGINAL_CONTENT_PATH = (id: string): string => `/api/v1/files/${id}/content`;

function formatFileSize(size: number): string {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} КБ`
    : `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

export function FileViewer({
  fileId,
  files,
  onClose,
}: {
  fileId: string;
  files?: FilePreviewItem[];
  onClose?: () => void;
}): React.JSX.Element {
  const [activeFileId, setActiveFileId] = useState(fileId);
  const [view, setView] = useState<FileView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [textTruncated, setTextTruncated] = useState(false);
  const [oneToOne, setOneToOne] = useState(false);
  const [lensEnabled, setLensEnabled] = useState(false);
  const [lensGeometry, setLensGeometry] = useState<LensGeometry | null>(null);
  const [forceOriginal, setForceOriginal] = useState(false);
  const [lensNaturalSize, setLensNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [pollingRun, setPollingRun] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const lensImageRef = useRef<HTMLImageElement>(null);

  useEffect(() => setActiveFileId(fileId), [fileId]);

  const activeIndex = files?.findIndex((file) => file.id === activeFileId) ?? -1;
  const navigate = useCallback((step: -1 | 1) => {
    if (!files || activeIndex < 0 || files.length < 2) return;
    const next = (activeIndex + step + files.length) % files.length;
    const nextFile = files[next];
    if (nextFile) setActiveFileId(nextFile.id);
  }, [activeIndex, files]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let attempts = 0;
    setView(null);
    setError(null);
    setTextPreview(null);
    setTextTruncated(false);
    setForceOriginal(false);
    setImageUnavailable(false);
    setPollTimedOut(false);
    setLensGeometry(null);
    setLensNaturalSize(null);
    setLensEnabled(false);
    setOneToOne(false);

    const load = async (): Promise<void> => {
      try {
        const nextView = await getFileView(activeFileId);
        if (cancelled) return;
        setView(nextView);
        setError(null);
        if (nextView.previewType === 'image' && (!nextView.inlineContentUrl || nextView.previewStatus === 'failed')) {
          setForceOriginal(true);
        }
        if (nextView.previewStatus === 'pending' || nextView.previewStatus === 'processing') {
          if (attempts >= VIEW_POLL_ATTEMPTS) {
            setPollTimedOut(true);
            return;
          }
          attempts += 1;
          timeoutId = window.setTimeout(() => void load(), 1500);
        }
      } catch (loadError) {
        if (!cancelled) {
          setPollTimedOut(true);
          setError(loadError instanceof Error ? loadError.message : 'Не удалось открыть файл.');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [activeFileId, pollingRun]);

  useEffect(() => {
    if (!view?.inlineContentUrl || view.previewType !== 'text' || view.previewStatus !== 'ready') return;
    let cancelled = false;
    const loadText = async (): Promise<void> => {
      try {
        const response = await fetch(resolveFileApiUrl(view.inlineContentUrl!), {
          credentials: 'include', cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Preview request failed with status ${response.status}`);
        const content = await response.text();
        if (!cancelled) {
          setTextPreview(content);
          setTextTruncated(response.headers.get('X-Content-Truncated') === '1');
        }
      } catch (previewError) {
        if (!cancelled) setError(previewError instanceof Error ? previewError.message : 'Не удалось загрузить текстовый предпросмотр.');
      }
    };
    void loadText();
    return () => { cancelled = true; };
  }, [view]);

  const handleRetry = async (): Promise<void> => {
    setError(null);
    setPollTimedOut(false);
    if (!view) {
      setPollingRun((current) => current + 1);
      return;
    }
    try {
      setView(await retryFilePreview(activeFileId));
      setPollingRun((current) => current + 1);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : 'Не удалось повторить формирование предпросмотра.');
    }
  };

  const inlineUrl = view?.inlineContentUrl ? resolveFileApiUrl(view.inlineContentUrl) : null;
  const originalUrl = view ? resolveFileApiUrl(ORIGINAL_CONTENT_PATH(view.id)) : null;
  const downloadUrl = view ? resolveFileApiUrl(view.downloadUrl) : '#';
  const isWaiting = view?.previewStatus === 'pending' || view?.previewStatus === 'processing';
  const activeFile = files?.find((file) => file.id === activeFileId);
  const displayName = view?.originalName ?? activeFile?.originalName ?? 'Загрузка файла…';

  const updateLensPoint = (event: React.PointerEvent<HTMLDivElement>): void => {
    const image = imageRef.current;
    const original = lensImageRef.current;
    if (!image || !original || original.naturalWidth === 0 || original.naturalHeight === 0) {
      setLensGeometry(null);
      return;
    }
    const rect = image.getBoundingClientRect();
    setLensGeometry(getLensGeometry(
      { x: event.clientX, y: event.clientY },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
      original.naturalWidth,
      original.naturalHeight,
    ));
  };

  const imageElement = view?.previewType === 'image' && originalUrl && !imageUnavailable ? (
    <div
      className={`${styles.imageStage}${oneToOne ? ` ${styles.imageStageOneToOne}` : ''}`}
      role="region"
      aria-label="Просмотр изображения. При масштабе 1:1 прокручивайте область клавиатурой или касанием."
      tabIndex={oneToOne ? 0 : -1}
      onPointerMove={(event) => {
        if (lensEnabled && event.pointerType === 'mouse' && window.matchMedia('(pointer: fine)').matches) updateLensPoint(event);
      }}
      onPointerLeave={() => setLensGeometry(null)}
    >
      <img
        ref={imageRef}
        className={styles.viewerImage}
        src={oneToOne || forceOriginal || !inlineUrl ? originalUrl : inlineUrl}
        alt={displayName}
        onLoad={() => { setImageUnavailable(false); setLensGeometry(null); }}
        onError={() => {
          if (!oneToOne && !forceOriginal) setForceOriginal(true);
          else setImageUnavailable(true);
        }}
      />
      {lensEnabled ? <img
        ref={lensImageRef}
        className={styles.lensPreload}
        src={originalUrl}
        alt=""
        aria-hidden="true"
        onLoad={(event) => setLensNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      /> : null}
      {lensEnabled && lensGeometry && lensNaturalSize && originalUrl ? <div
        aria-hidden="true"
        className={styles.lens}
        style={{
          left: lensGeometry.left,
          top: lensGeometry.top,
          width: lensGeometry.diameter,
          height: lensGeometry.diameter,
          backgroundImage: `url("${originalUrl}")`,
          backgroundSize: `${lensGeometry.backgroundWidth}px ${lensGeometry.backgroundHeight}px`,
          backgroundPosition: `${lensGeometry.backgroundX}px ${lensGeometry.backgroundY}px`,
        }}
      /> : null}
    </div>
  ) : null;

  const toolbarActions = view ? <div className={styles.toolbar}>
    {view.previewType === 'image' ? <>
      <IconButton aria-label="Вписать изображение" title="Вписать изображение" disabled={!oneToOne} onClick={() => { setOneToOne(false); setImageUnavailable(false); setLensGeometry(null); }}><FitToScreenIcon size={18} /></IconButton>
      <IconButton aria-label="Показать оригинал 1:1" title="Показать оригинал 1:1" disabled={oneToOne} onClick={() => { setOneToOne(true); setImageUnavailable(false); setLensGeometry(null); }}><OneToOneIcon size={18} /></IconButton>
      <IconButton aria-label={lensEnabled ? 'Выключить лупу' : 'Включить лупу'} title={lensEnabled ? 'Выключить лупу' : 'Включить лупу'} aria-pressed={lensEnabled} className={styles.lensToggle} onClick={() => { setLensEnabled((value) => !value); setLensGeometry(null); }}><SearchIcon size={18} /></IconButton>
    </> : null}
    <a className={`ui-icon-button ${styles.downloadAction}`} href={downloadUrl} aria-label="Скачать оригинал" title="Скачать оригинал"><MediaActionIcon name="download" /></a>
  </div> : null;

  const viewer = <>
    {!onClose ? <header className={styles.header}>
      <div className={styles.metadata}>
        <h1 title={displayName}>{displayName}</h1>
        <p>{view ? `${view.mimeType} · ${formatFileSize(view.sizeBytes)}` : error ?? 'Загрузка файла…'}</p>
      </div>
      {toolbarActions}
    </header> : <div className={styles.galleryToolbar}>{toolbarActions}</div>}
    <section
      className={styles.stage}
      aria-live="polite"
      tabIndex={oneToOne ? 0 : undefined}
      aria-label={oneToOne ? 'Прокручиваемая область изображения 1:1' : undefined}
    >
      {!view && error ? <div className={styles.viewerState} role="alert">
        <strong>Не удалось загрузить сведения о файле</strong>
        <span>{error}</span>
        <Button onClick={() => void handleRetry()}>Повторить</Button>
      </div> : null}
      {!view && !error ? <div className={styles.viewerState} role="status" aria-busy="true">Загрузка файла…</div> : null}
      {view && error ? <div className={styles.viewerState} role="alert">{error}<Button onClick={() => setPollingRun((value) => value + 1)}>Повторить загрузку</Button></div> : null}
      {view && isWaiting ? <div className={styles.viewerState}>
        <strong>Предпросмотр документа формируется…</strong>
        {pollTimedOut ? error ? <span>Автообновление остановлено из-за ошибки.</span> : <Button onClick={() => { setPollTimedOut(false); setPollingRun((value) => value + 1); }}>Обновить статус</Button> : <span>Статус обновится автоматически.</span>}
      </div> : null}
      {view?.previewStatus === 'failed' ? <div className={styles.viewerState}>
        <strong>Не удалось сформировать предпросмотр документа</strong>
        <span>{view.errorMessage || 'Предпросмотр недоступен.'}</span>
        {view.previewType !== 'unsupported' ? <Button onClick={() => void handleRetry()}>Повторить</Button> : null}
      </div> : null}
      {imageElement}
      {imageUnavailable ? <div className={styles.viewerState}>
        <strong>Не удалось открыть изображение</strong>
        <span>Оригинал файла также недоступен для просмотра. Попробуйте скачать его.</span>
      </div> : null}
      {view?.previewStatus === 'ready' && view.previewType === 'pdf' && inlineUrl ? <iframe className={styles.pdf} src={inlineUrl} title={`Предпросмотр ${view.originalName}`} /> : null}
      {view?.previewStatus === 'ready' && view.previewType === 'text' ? <div className={styles.text}>
        {textTruncated ? <p>Показаны первые 512 КБ файла.</p> : null}
        <pre>{textPreview ?? 'Загрузка текста…'}</pre>
      </div> : null}
    </section>
    {onClose && files && files.length > 1 ? <nav className={styles.galleryNav} aria-label="Навигация по вложениям">
      <IconButton aria-label="Предыдущий файл" onClick={() => navigate(-1)}><ChevronLeftIcon /></IconButton>
      <span>{Math.max(activeIndex + 1, 1)} из {files.length}</span>
      <IconButton aria-label="Следующий файл" onClick={() => navigate(1)}><ChevronRightIcon /></IconButton>
    </nav> : null}
  </>;

  if (!onClose) return <div className={styles.page}>{viewer}</div>;
  return <Dialog
    open
    onKeyDown={(event) => {
      // Handle gallery shortcuts only within this viewer, never the document
      // or the native 1:1 scrolling region.
      if (event.defaultPrevented || oneToOne || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); navigate(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); navigate(1); }
    }}
    onOpenChange={(open) => { if (!open) onClose(); }}
    title={<span title={displayName}>{displayName}</span>}
    description={view ? `${view.mimeType} · ${formatFileSize(view.sizeBytes)}` : 'Загрузка предпросмотра…'}
    className={styles.dialog}
  >
    <div className={styles.gallery}>{viewer}</div>
  </Dialog>;
}

