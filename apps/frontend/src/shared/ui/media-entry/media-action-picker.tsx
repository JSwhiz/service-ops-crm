'use client';

import React, { useRef, useState } from 'react';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

import styles from './media-action-picker.module.css';

export function MediaActionPicker({
  onPick,
  disabled = false,
  allowGenericFile = true,
  genericFileAccept,
  iconOnly = false,
}: {
  onPick: (file: File) => Promise<void>;
  disabled?: boolean;
  allowGenericFile?: boolean;
  genericFileAccept?: string;
  iconOnly?: boolean;
}): React.JSX.Element {
  const [isBusy, setIsBusy] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0] ?? null;

    event.target.value = '';

    if (!file) {
      return;
    }

    setIsBusy(true);
    try {
      await onPick(file);
    } finally {
      setIsBusy(false);
    }
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
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(event) => void handleFile(event)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept={genericFileAccept}
        style={{ display: 'none' }}
        onChange={(event) => void handleFile(event)}
      />

      <button
        className={iconOnly ? styles.iconButton : undefined}
        type="button"
        disabled={isDisabled}
        onClick={() => cameraInputRef.current?.click()}
        aria-label="Сделать фото"
        title="Сделать фото"
      >
        {iconOnly ? <MediaActionIcon name="camera" /> : isBusy ? 'Загружаем…' : 'Сделать фото'}
      </button>

      <button
        className={iconOnly ? styles.iconButton : undefined}
        type="button"
        disabled={isDisabled}
        onClick={() => galleryInputRef.current?.click()}
        aria-label="Выбрать из галереи"
        title="Выбрать из галереи"
      >
        {iconOnly ? <MediaActionIcon name="gallery" /> : 'Выбрать из галереи'}
      </button>

      {allowGenericFile ? (
        <button
          className={iconOnly ? styles.iconButton : undefined}
          type="button"
          disabled={isDisabled}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Выбрать файл"
          title="Выбрать файл"
        >
          {iconOnly ? <MediaActionIcon name="file" /> : 'Выбрать файл'}
        </button>
      ) : null}
      {isBusy ? <span className={styles.visuallyHidden} role="status">Загружаем файл…</span> : null}
    </div>
  );
}
