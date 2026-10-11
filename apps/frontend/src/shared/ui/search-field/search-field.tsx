'use client';

import React, { useEffect, useRef, useState } from 'react';

import styles from './search-field.module.css';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  busy?: boolean;
  className?: string;
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
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
