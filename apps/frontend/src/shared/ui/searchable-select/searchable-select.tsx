'use client';

import React, { useEffect, useRef, useState } from 'react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
}

interface SearchableSelectProps {
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  loading?: boolean;
  clearable?: boolean;
  asyncSearch?: (
    query: string,
  ) => Promise<SearchableSelectOption[]>;
  selectedOption?: SearchableSelectOption | null;
}

export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Выберите значение',
  searchPlaceholder = 'Начните вводить...',
  emptyText = 'Ничего не найдено',
  disabled = false,
  loading = false,
  clearable = true,
  asyncSearch,
  selectedOption = null,
}: SearchableSelectProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const asyncSearchRef = useRef(asyncSearch);
  const optionsRef = useRef(options);
  const requestSequenceRef = useRef(0);
  const optionCacheRef = useRef(new Map<string, SearchableSelectOption>());
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [asyncOptions, setAsyncOptions] = useState(options);
  const [isAsyncLoading, setIsAsyncLoading] = useState(false);
  const [asyncError, setAsyncError] = useState(false);

  optionsRef.current = options;

  for (const option of options) {
    optionCacheRef.current.set(option.value, option);
  }
  if (selectedOption) {
    optionCacheRef.current.set(selectedOption.value, selectedOption);
  }

  const selected =
    options.find((option) => option.value === value) ??
    asyncOptions.find((option) => option.value === value) ??
    selectedOption ??
    optionCacheRef.current.get(value) ??
    null;
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const visibleOptions = asyncSearch
    ? asyncOptions
    : normalizedQuery
      ? options.filter((option) =>
          `${option.label} ${option.searchText ?? ''}`
            .toLocaleLowerCase('ru')
            .includes(normalizedQuery),
        )
      : options;

  useEffect(() => {
    asyncSearchRef.current = asyncSearch;
  }, [asyncSearch]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    setAsyncOptions(optionsRef.current);
    setAsyncError(false);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !asyncSearchRef.current) {
      setIsAsyncLoading(false);
      return;
    }

    const requestSequence = ++requestSequenceRef.current;
    setIsAsyncLoading(true);
    setAsyncError(false);
    const timeout = window.setTimeout(() => {
      const search = asyncSearchRef.current;
      if (!search) return;

      void search(query.trim())
        .then((nextOptions) => {
          if (requestSequence !== requestSequenceRef.current) return;
          for (const option of nextOptions) {
            optionCacheRef.current.set(option.value, option);
          }
          setAsyncOptions(nextOptions);
          setActiveIndex(0);
        })
        .catch(() => {
          if (requestSequence !== requestSequenceRef.current) return;
          setAsyncOptions([]);
          setAsyncError(true);
        })
        .finally(() => {
          if (requestSequence === requestSequenceRef.current) {
            setIsAsyncLoading(false);
          }
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      if (requestSequence === requestSequenceRef.current) {
        requestSequenceRef.current += 1;
      }
    };
  }, [isOpen, query]);

  const choose = (nextValue: string): void => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div className="searchable-select" ref={rootRef}>
      <span className="detail-label">{label}</span>
      <button
        type="button"
        className="searchable-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled || loading}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={selected ? undefined : 'page-muted'}>
          {loading ? 'Загрузка...' : selected?.label ?? placeholder}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {isOpen ? (
        <div className="searchable-select__popover">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={`Поиск: ${label}`}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) =>
                  Math.min(current + 1, Math.max(0, visibleOptions.length - 1)),
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter' && visibleOptions[activeIndex]) {
                event.preventDefault();
                choose(visibleOptions[activeIndex].value);
              } else if (event.key === 'Escape') {
                setIsOpen(false);
              }
            }}
          />
          <div className="searchable-select__options" role="listbox">
            {clearable && value ? (
              <button type="button" onClick={() => choose('')}>
                Очистить выбор
              </button>
            ) : null}
            {isAsyncLoading ? (
              <div className="searchable-select__empty">Загрузка...</div>
            ) : asyncError ? (
              <div className="searchable-select__empty">
                Не удалось загрузить варианты
              </div>
            ) : visibleOptions.length === 0 ? (
              <div className="searchable-select__empty">{emptyText}</div>
            ) : (
              visibleOptions.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={index === activeIndex ? 'is-active' : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option.value)}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
