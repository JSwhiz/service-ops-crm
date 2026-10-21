'use client';

import React, { useEffect, useRef, useState } from 'react';

import styles from './search-field.module.css';
import { SearchIcon } from '@/shared/ui/icons/icons';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  busy?: boolean;
  className?: string;
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  busy = false,
  className,
}: SearchFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const composingRef = useRef(false);

  useEffect(() => setDraft(value), [value]);

  return (
    <div className={[styles.searchBox, className].filter(Boolean).join(' ')} data-active={draft ? 'true' : 'false'}>
      <SearchIcon />
      <input
        type="search"
        value={draft}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraft(nextValue);
          if (!composingRef.current) onChange(nextValue);
        }}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const nextValue = event.currentTarget.value;
          setDraft(nextValue);
          onChange(nextValue);
        }}
        placeholder={placeholder}
        aria-label={label}
        aria-busy={busy || undefined}
      />
      {draft ? (
        <button
          type="button"
          className={styles.clearButton}
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label="Очистить поиск"
          title="Очистить поиск"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
