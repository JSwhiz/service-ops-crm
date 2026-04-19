'use client';

import React, { useRef, useState } from 'react';

export function MediaActionPicker({
  onPick,
  disabled = false,
  allowGenericFile = true,
  genericFileAccept,
}: {
  onPick: (file: File) => Promise<void>;
  disabled?: boolean;
  allowGenericFile?: boolean;
  genericFileAccept?: string;
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
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        type="button"
        disabled={isDisabled}
        onClick={() => cameraInputRef.current?.click()}
      >
        {isBusy ? 'Загружаем...' : 'Сделать фото'}
      </button>

      <button
        type="button"
        disabled={isDisabled}
        onClick={() => galleryInputRef.current?.click()}
      >
        Выбрать из галереи
      </button>

      {allowGenericFile ? (
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => fileInputRef.current?.click()}
        >
          Выбрать файл
        </button>
      ) : null}
    </div>
  );
}
