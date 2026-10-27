'use client';

import React, { useRef, useState } from 'react';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

import styles from './media-action-picker.module.css';
import { Alert, Button, IconButton } from '@/shared/ui/foundation';

export function MediaActionPicker({
  onPick,
  disabled = false,
  allowGenericFile = true,
  genericFileAccept,
  iconOnly = false,
  onBusyChange,
}: {
  onPick: (file: File) => Promise<void>;
  disabled?: boolean;
  allowGenericFile?: boolean;
  genericFileAccept?: string;
  iconOnly?: boolean;
  onBusyChange?: (busy: boolean) => void;
}): React.JSX.Element {
  const [isBusy, setIsBusy] = useState(false);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const processFiles = async (files: File[]): Promise<void> => {
    setIsBusy(true);
    onBusyChange?.(true);
    const failed: File[] = [];
    try {
      for (const file of files) {
        try { await onPick(file); } catch { failed.push(file); }
      }
      setFailedFiles(failed);
    } finally { setIsBusy(false); onBusyChange?.(false); }
  };
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

      {[
        { name: 'camera' as const, label: 'Сделать фото', input: cameraInputRef },
        { name: 'gallery' as const, label: 'Выбрать из галереи', input: galleryInputRef },
        ...(allowGenericFile ? [{ name: 'file' as const, label: 'Выбрать файл', input: fileInputRef }] : []),
      ].map((action) => iconOnly ? <IconButton key={action.name} disabled={isDisabled} aria-label={action.label} title={action.label} onClick={() => action.input.current?.click()}><MediaActionIcon name={action.name} /></IconButton>
        : <Button key={action.name} disabled={isDisabled} icon={<MediaActionIcon name={action.name} />} onClick={() => action.input.current?.click()}>{action.label}</Button>)}
      {isBusy ? <span className={styles.visuallyHidden} role="status">Загружаем файл…</span> : null}
      {failedFiles.length > 0 ? <Alert tone="danger">Не удалось добавить {failedFiles.length} файл(ов): {failedFiles.map((file) => file.name).join(', ')}. Остальные сохранены. <Button disabled={isDisabled} onClick={() => void processFiles(failedFiles)}>Повторить неудачные</Button></Alert> : null}
    </div>
  );
}
