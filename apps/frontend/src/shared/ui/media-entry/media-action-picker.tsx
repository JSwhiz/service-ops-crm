'use client';

import React, { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '@/shared/api/fetcher';
import { useAuth } from '@/shared/auth/use-auth';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

import styles from './media-action-picker.module.css';
import { Alert, Button, IconButton } from '@/shared/ui/foundation';
import { AttachmentTrigger } from './attachment-trigger';
import { getMediaMenuPosition, type MediaMenuPosition } from './media-action-position';
import { mergeMediaUploadFailures, runMediaUploadBatch, type MediaUploadFailure } from './media-upload-batch';

export function MediaActionPicker({
  onPick,
  disabled = false,
  uploadAllowed = true,
  allowGenericFile = true,
  genericFileAccept,
  iconOnly = false,
  compactMenu = true,
  compactLabel = 'Добавить фото или файл',
  onBusyChange,
}: {
  onPick: (file: File) => Promise<void>;
  disabled?: boolean;
  /** Live source permission; separate from temporary form/busy disabling. */
  uploadAllowed?: boolean;
  allowGenericFile?: boolean;
  genericFileAccept?: string;
  iconOnly?: boolean;
  /** One chat-style paperclip trigger with a menu of media sources. */
  compactMenu?: boolean;
  compactLabel?: string;
  onBusyChange?: (busy: boolean) => void;
}): React.JSX.Element {
  const { user, capabilitiesRefreshError } = useAuth();
  const snapshotBlocked = useContext(AccessSnapshotBlockedContext);
  const canUpload = uploadAllowed && user?.capabilities?.canUploadFile === true && !snapshotBlocked && !capabilitiesRefreshError;
  const uploadAvailable = useRef(canUpload);
  uploadAvailable.current = canUpload;
  const mountLifetime = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    mountLifetime.current += 1;
    return () => {
      mounted.current = false;
      mountLifetime.current += 1;
    };
  }, []);
  const [isBusy, setIsBusy] = useState(false);
  const batchInFlight = useRef(false);
  const [pendingFailures, setPendingFailures] = useState<Array<MediaUploadFailure<File>>>([]);
  const failedFiles = pendingFailures.map(failure => failure.file);
  const failureDetails = pendingFailures.map(failure => `${failure.file.name}: ${failure.stopped
    ? 'доступ изменился или загрузка временно недоступна; файл остался в очереди'
    : failure.cause instanceof ApiError && failure.cause.statusCode === 413
        ? 'файл превышает допустимый размер 25 МБ'
        : 'не удалось подтвердить загрузку; обновите список вложений перед повторной попыткой'}`);
  const processFiles = async (files: File[]): Promise<void> => {
    if (!mounted.current || batchInFlight.current) return;
    batchInFlight.current = true;
    const lifetime = mountLifetime.current;
    const isCurrentPicker = (): boolean => mounted.current && mountLifetime.current === lifetime;
    const generation = getAccessGeneration();
    const availableAtStart = !disabled;
    setIsBusy(true);
    onBusyChange?.(true);
    try {
      const failures = await runMediaUploadBatch(files,
        () => isCurrentPicker() && availableAtStart && uploadAvailable.current && isAccessGenerationCurrent(generation), onPick);
      if (isCurrentPicker()) setPendingFailures(previous => mergeMediaUploadFailures(previous, files, failures));
    } finally {
      batchInFlight.current = false;
      if (isCurrentPicker()) {
        setIsBusy(false);
        onBusyChange?.(false);
      }
    }
  };
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MediaMenuPosition | null>(null);
  const isDisabled = disabled || isBusy || !canUpload;
  useEffect(() => { if (isDisabled) setMenuOpen(false); }, [isDisabled]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const updatePosition = (): void => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const viewport = window.visualViewport;
      const safeWidth = Math.max(1, (viewport?.width ?? window.innerWidth) - 24);
      menu.style.maxWidth = `${Math.min(300, safeWidth)}px`;
      menu.style.minWidth = `${Math.min(224, safeWidth)}px`;
      const next = getMediaMenuPosition(
        anchor,
        { width: menu.getBoundingClientRect().width, height: menu.scrollHeight + menu.offsetHeight - menu.clientHeight },
        { width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight, left: viewport?.offsetLeft, top: viewport?.offsetTop },
      );
      setMenuPosition(next);
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [allowGenericFile, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.parentElement?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    queueMicrotask(() => menuItemRefs.current[0]?.focus());
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const openSource = (input: React.RefObject<HTMLInputElement | null>): void => {
    setMenuOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    if (!isDisabled) input.current?.click();
  };

  const handleFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const files = Array.from(event.target.files ?? []);

    event.target.value = '';

    if (files.length === 0) {
      return;
    }

    await processFiles(files);
  };

  return (
    <div className={styles.actions} aria-label="Добавить вложение">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        disabled={isDisabled}
        onChange={(event) => void handleFile(event)}
      />
      <input
        ref={galleryInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        disabled={isDisabled}
        onChange={(event) => void handleFile(event)}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={genericFileAccept}
        style={{ display: 'none' }}
        disabled={isDisabled}
        onChange={(event) => void handleFile(event)}
      />

      {compactMenu || iconOnly ? (
        <div className={styles.menuRoot}>
          <AttachmentTrigger
            ref={triggerRef}
            disabled={isDisabled}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuOpen ? menuId : undefined}
            aria-label={compactLabel}
            title={canUpload ? 'Добавить фото или файл' : 'Загрузка вложений недоступна'}
            onClick={() => setMenuOpen((open) => !open)}
          />
          {menuOpen && !isDisabled ? (
            <div
              id={menuId}
              ref={menuRef}
              className={styles.menu}
              role="menu"
              aria-label="Выберите способ добавления вложения"
              data-placement={menuPosition?.placement}
              style={menuPosition ? {
                left: `${menuPosition.left}px`,
                top: `${menuPosition.top}px`,
                maxHeight: `${menuPosition.maxHeight}px`,
              } : undefined}
              onKeyDown={(event) => {
                const current = menuItemRefs.current.findIndex((node) => node === document.activeElement);
                const count = allowGenericFile ? 3 : 2;
                const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
                if (step) {
                  event.preventDefault();
                  menuItemRefs.current[(current + step + count) % count]?.focus();
                } else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  menuItemRefs.current[event.key === 'Home' ? 0 : count - 1]?.focus();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenuOpen(false);
                  triggerRef.current?.focus();
                } else if (event.key === 'Tab') {
                  setMenuOpen(false);
                  triggerRef.current?.focus();
                  if (event.shiftKey) event.preventDefault();
                }
              }}
            >
              {[
                { label: 'Сделать фото', icon: 'camera' as const, input: cameraInputRef },
                { label: 'Выбрать из галереи', icon: 'gallery' as const, input: galleryInputRef },
                ...(allowGenericFile ? [{ label: 'Выбрать файл', icon: 'file' as const, input: fileInputRef }] : []),
              ].map((action, index) => (
                <button
                  key={action.icon}
                  ref={(node) => { menuItemRefs.current[index] = node; }}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={styles.menuItem}
                  onClick={() => openSource(action.input)}
                >
                  <MediaActionIcon name={action.icon} />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : [
        { name: 'camera' as const, label: 'Сделать фото', input: cameraInputRef },
        { name: 'gallery' as const, label: 'Выбрать из галереи', input: galleryInputRef },
        ...(allowGenericFile ? [{ name: 'file' as const, label: 'Выбрать файл', input: fileInputRef }] : []),
      ].map((action) => iconOnly ? <IconButton key={action.name} disabled={isDisabled} aria-label={action.label} title={action.label} onClick={() => action.input.current?.click()}><MediaActionIcon name={action.name} /></IconButton>
        : <Button key={action.name} disabled={isDisabled} icon={<MediaActionIcon name={action.name} />} onClick={() => action.input.current?.click()}>{action.label}</Button>)}
      {isBusy ? <span className={styles.visuallyHidden} role="status">Загружаем файл…</span> : null}
      {failedFiles.length > 0 ? <Alert tone="danger" role="alert"><div className="ui-stack ui-stack--sm"><span>Для части файлов загрузка не подтверждена. Проверьте список вложений перед повтором.</span><ul className="ui-plain-list">{failureDetails.map((detail, index) => <li key={index}>{detail}</li>)}</ul><div className="ui-actions"><Button disabled={isDisabled} onClick={() => void processFiles(failedFiles)}>Повторить неудачные</Button><Button disabled={isBusy} onClick={() => setPendingFailures([])}>Убрать из очереди</Button></div></div></Alert> : null}
    </div>
  );
}
