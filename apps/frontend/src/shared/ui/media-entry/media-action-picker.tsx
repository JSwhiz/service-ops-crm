'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '@/shared/api/fetcher';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

import styles from './media-action-picker.module.css';
import { Alert, Button, IconButton } from '@/shared/ui/foundation';
import { AttachmentTrigger } from './attachment-trigger';
import { getMediaMenuPosition, type MediaMenuPosition } from './media-action-position';

export function MediaActionPicker({
  onPick,
  disabled = false,
  allowGenericFile = true,
  genericFileAccept,
  iconOnly = false,
  compactMenu = true,
  compactLabel = 'Добавить фото или файл',
  onBusyChange,
}: {
  onPick: (file: File) => Promise<void>;
  disabled?: boolean;
  allowGenericFile?: boolean;
  genericFileAccept?: string;
  iconOnly?: boolean;
  /** One chat-style paperclip trigger with a menu of media sources. */
  compactMenu?: boolean;
  compactLabel?: string;
  onBusyChange?: (busy: boolean) => void;
}): React.JSX.Element {
  const [isBusy, setIsBusy] = useState(false);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [failureDetails, setFailureDetails] = useState<string[]>([]);
  const processFiles = async (files: File[]): Promise<void> => {
    setIsBusy(true);
    onBusyChange?.(true);
    const failed: File[] = [];
    const details: string[] = [];
    try {
      for (const file of files) {
        try { await onPick(file); } catch (cause) {
          failed.push(file);
          details.push(`${file.name}: ${cause instanceof ApiError && cause.statusCode === 413
            ? 'файл превышает допустимый размер 25 МБ'
            : 'не удалось загрузить; проверьте подключение и повторите попытку'}`);
        }
      }
      setFailedFiles(failed);
      setFailureDetails(details);
    } finally { setIsBusy(false); onBusyChange?.(false); }
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
    input.current?.click();
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

  const isDisabled = disabled || isBusy;

  return (
    <div className={styles.actions} aria-label="Добавить вложение">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => void handleFile(event)}
      />
      <input
        ref={galleryInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => void handleFile(event)}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={genericFileAccept}
        style={{ display: 'none' }}
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
            title="Добавить фото или файл"
            onClick={() => setMenuOpen((open) => !open)}
          />
          {menuOpen ? (
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
      {failedFiles.length > 0 ? <Alert tone="danger" role="alert"><div className="ui-stack ui-stack--sm"><span>Часть файлов не загружена. Успешно загруженные файлы сохранены.</span><ul className="ui-plain-list">{failureDetails.map((detail, index) => <li key={index}>{detail}</li>)}</ul><div><Button disabled={isDisabled} onClick={() => void processFiles(failedFiles)}>Повторить неудачные</Button></div></div></Alert> : null}
    </div>
  );
}
