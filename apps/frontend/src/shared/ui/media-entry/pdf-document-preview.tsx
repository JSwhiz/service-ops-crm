'use client';

import React, { useEffect, useRef, useState } from 'react';

import { Button, IconButton } from '@/shared/ui/foundation';
import { ChevronLeftIcon, ChevronRightIcon } from '@/shared/ui/icons/icons';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import styles from './file-viewer.module.css';

export function PdfDocumentPreview({ url, title, downloadUrl }: { url: string; title: string; downloadUrl: string }): React.JSX.Element {
  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageRendering, setPageRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [accessibleText, setAccessibleText] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
    observer.observe(element);
    setContainerWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      cancelled = true;
      controller.abort();
      if (loadingTask) void loadingTask.destroy();
      setLoading(false);
      setError('Предпросмотр не успел загрузиться. Попробуйте ещё раз или скачайте оригинал.');
    }, 45_000);

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      setRenderFailed(false);
      setDocumentProxy(null);
      setPageNumber(1);
      try {
        if (typeof OffscreenCanvas === 'undefined') {
          setError('Предпросмотр PDF недоступен в этом браузере. Скачайте оригинал.');
          return;
        }
        const response = await fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Preview request failed (${response.status})`);
        const maxInputBytes = 25 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > maxInputBytes) {
          controller.abort();
          throw new RangeError('Preview input limit exceeded');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Preview streaming is unavailable');
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxInputBytes) {
              controller.abort();
              throw new RangeError('Preview input limit exceeded');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        const data = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        if (cancelled) return;

        const pdfjs = await import('pdfjs-dist');
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        loadingTask = pdfjs.getDocument({
          data,
          maxImageSize: -1,
          canvasMaxAreaInBytes: 32 * 1024 * 1024,
        });
        loadingTaskRef.current = loadingTask;
        const loadedDocument = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        setDocumentProxy(loadedDocument);
        setPageCount(loadedDocument.numPages);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof RangeError
          ? 'Файл слишком большой для предпросмотра. Скачайте оригинал.'
          : 'Не удалось отобразить предпросмотр PDF. Попробуйте ещё раз или скачайте оригинал.');
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      if (loadingTask) void loadingTask.destroy();
      if (loadingTaskRef.current === loadingTask) loadingTaskRef.current = null;
    };
  }, [retryKey, url]);

  useEffect(() => {
    if (!documentProxy) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let pageProxy: PDFPageProxy | null = null;
    let renderStage = 'page';
    const timeout = setTimeout(() => {
      cancelled = true;
      renderTask?.cancel();
      if (loadingTaskRef.current) void loadingTaskRef.current.destroy();
      setDocumentProxy(null);
      setRenderFailed(true);
      setPageRendering(false);
    }, 45_000);

    const renderPage = async (): Promise<void> => {
      try {
        pageProxy = await documentProxy.getPage(pageNumber);
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context || cancelled || containerWidth === 0) return;

        renderStage = 'viewport';
        const baseViewport = pageProxy.getViewport({ scale: 1 });
        const fitScale = Math.min((containerWidth - 32) / baseViewport.width, 2);
        const viewport = pageProxy.getViewport({ scale: Math.max(fitScale * zoomPercent / 100, 0.1) });
        const maxCanvasPixels = 16_000_000;
        const outputScale = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height)),
          8192 / viewport.width,
          8192 / viewport.height,
        );
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        setRenderFailed(false);
        setPageRendering(true);
        setAccessibleText('');

        renderStage = 'render';
        renderTask = pageProxy.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        await renderTask.promise;

        const text = await pageProxy.getTextContent().catch(() => null);
        const pageText = text?.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' ') ?? '';
        if (!cancelled) setAccessibleText(pageText);
      } catch (cause) {
        if (!cancelled) {
          if (process.env.NODE_ENV !== 'production') {
            console.error('PDF preview page failed', { stage: renderStage, type: cause instanceof Error ? cause.name : 'UnknownError' });
          }
          setRenderFailed(true);
        }
      } finally {
        clearTimeout(timeout);
        if (cancelled) pageProxy?.cleanup();
        else setPageRendering(false);
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      renderTask?.cancel();
    };
  }, [containerWidth, documentProxy, pageNumber, zoomPercent]);

  const changeZoom = (delta: number): void => {
    setZoomPercent((current) => Math.max(25, Math.min(300, current + delta)));
  };

  return (
    <div className={styles.pdfDocument}>
      <div className={styles.pdfToolbar} role="group" aria-label="Масштаб PDF">
        <IconButton aria-label="Уменьшить масштаб" disabled={zoomPercent <= 25} onClick={() => changeZoom(-25)}>−</IconButton>
        <output className={styles.pdfZoomValue} aria-live="polite">{zoomPercent}%</output>
        <IconButton aria-label="Увеличить масштаб" disabled={zoomPercent >= 300} onClick={() => changeZoom(25)}>+</IconButton>
        <Button size="sm" variant="ghost" disabled={zoomPercent === 100} onClick={() => setZoomPercent(100)}>По ширине</Button>
      </div>
      <div className={styles.pdfPage} ref={containerRef} aria-busy={loading || pageRendering}>
        {loading ? <div className={styles.viewerState} role="status">Загружаем PDF…</div> : null}
        {error ? <div className={styles.viewerState} role="alert">
          <strong>{error}</strong>
          <div className="ui-inline"><Button onClick={() => setRetryKey((key) => key + 1)}>Повторить предпросмотр</Button><a href={downloadUrl}>Скачать оригинал</a></div>
        </div> : null}
        {renderFailed ? <div className={styles.pdfRenderError} role="alert">
          <strong>Не удалось отобразить эту страницу.</strong>
          <div className="ui-inline"><Button onClick={() => setRetryKey((key) => key + 1)}>Повторить предпросмотр</Button><a href={downloadUrl}>Скачать оригинал</a></div>
        </div> : null}
        {documentProxy && !error ? <>
          <canvas ref={canvasRef} hidden={renderFailed} role="img" aria-label={`${title}, страница ${pageNumber} из ${pageCount}`} />
          <span className={styles.pdfAccessibleText}>{accessibleText || `Страница ${pageNumber} из ${pageCount}.`}</span>
        </> : null}
      </div>
      {pageCount > 1 ? <nav className={styles.pdfPagination} aria-label="Страницы PDF">
        <IconButton aria-label="Предыдущая страница" disabled={pageNumber <= 1} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}><ChevronLeftIcon /></IconButton>
        <span>Страница {pageNumber} из {pageCount}</span>
        <IconButton aria-label="Следующая страница" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}><ChevronRightIcon /></IconButton>
      </nav> : null}
    </div>
  );
}
