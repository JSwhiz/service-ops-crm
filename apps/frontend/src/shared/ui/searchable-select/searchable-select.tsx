'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

import { useFloatingPosition } from '../overlays/use-floating-position';
import { handleSelectEscape } from './select-escape';
import styles from './searchable-select.module.css';

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
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
  searchable?: boolean;
  viewportAware?: boolean;
  required?: boolean;
  hideLabel?: boolean;
  minimumSearchLength?: number;
  searchPromptText?: string;
  searchInputVariant?: 'default' | 'registry';
  /** Attributes forwarded to the trigger, e.g. the id/aria wiring from Field. */
  triggerProps?: Pick<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'id' | 'name' | 'onFocus' | 'aria-describedby' | 'aria-invalid' | 'aria-labelledby'
  >;
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
  searchable = true,
  viewportAware = true,
  required = false,
  hideLabel = false,
  minimumSearchLength = 0,
  searchPromptText,
  searchInputVariant = 'default',
  triggerProps,
}: SearchableSelectProps): React.JSX.Element {
  const labelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
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
  const popoverPosition = useFloatingPosition(
    isOpen && viewportAware,
    triggerRef,
    popoverRef,
    true,
  );

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
    (selectedOption?.value === value ? selectedOption : null) ??
    optionCacheRef.current.get(value) ??
    null;
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const needsMoreSearch = normalizedQuery.length < minimumSearchLength;
  const visibleOptions = asyncSearch
    ? needsMoreSearch ? [] : asyncOptions
    : normalizedQuery
      ? normalizedQuery.length < minimumSearchLength ? [] : options.filter((option) =>
          `${option.label} ${option.searchText ?? ''}`
            .toLocaleLowerCase('ru')
            .includes(normalizedQuery),
        )
      : minimumSearchLength > 0 ? [] : options;

  useEffect(() => {
    asyncSearchRef.current = asyncSearch;
  }, [asyncSearch]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
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

    if (query.trim().length < minimumSearchLength) {
      requestSequenceRef.current += 1;
      setAsyncOptions([]);
      setIsAsyncLoading(false);
      setAsyncError(false);
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
  }, [isOpen, minimumSearchLength, query]);

  const choose = (nextValue: string): void => {
    onChange(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="searchable-select" ref={rootRef}
      onKeyDown={(event) => handleSelectEscape(event, isOpen, () => setIsOpen(false), () => triggerRef.current?.focus({ preventScroll: true }))}>
      {hideLabel ? null : <span id={labelId} className="ui-detail-label">{label}</span>}
      <button
        {...triggerProps}
        ref={triggerRef}
        type="button"
        className={`searchable-select__trigger ${styles.wrappingTrigger}`}
        aria-label={hideLabel && label ? label : undefined}
        aria-labelledby={triggerProps?.['aria-labelledby'] ?? (!hideLabel ? labelId : undefined)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-required={required || undefined}
        disabled={disabled || loading}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={selected ? undefined : 'ui-text-muted'}>
          {loading ? 'Загрузка...' : selected?.label ?? placeholder}
        </span>
        <svg className="searchable-select__chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8l4 4 4-4" />
        </svg>
      </button>
      {isOpen ? (
        <div
          ref={popoverRef}
          className={`searchable-select__popover${viewportAware ? ` ${styles.floatingPopover}` : ''}`}
          popover={viewportAware ? 'manual' : undefined}
          data-placement={viewportAware ? (popoverPosition?.placement === 'above' ? 'top' : 'bottom') : undefined}
          style={viewportAware ? {
            left: popoverPosition?.left,
            top: popoverPosition?.top,
            bottom: 'auto',
            '--anchored-popover-max-height': `${Math.min(340, popoverPosition?.maxHeight ?? 340)}px`,
            visibility: popoverPosition ? 'visible' : 'hidden',
          } as React.CSSProperties : undefined}
        >
          {searchable ? (
            <input
              ref={searchRef}
              type="search"
              className={searchInputVariant === 'registry' ? styles.registrySearchInput : undefined}
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
                }
              }}
            />
          ) : null}
          <div className={`searchable-select__options ${styles.wrappingOptions}`} role="listbox" aria-label={label}>
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
              <div className="searchable-select__empty">
                {needsMoreSearch && searchPromptText ? searchPromptText : emptyText}
              </div>
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
                  <span className="searchable-select__option-label">
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="searchable-select__option-description">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
