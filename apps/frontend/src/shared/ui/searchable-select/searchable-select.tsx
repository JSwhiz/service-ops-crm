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
}: SearchableSelectProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const visibleOptions = normalizedQuery
    ? options.filter((option) =>
        `${option.label} ${option.searchText ?? ''}`
          .toLocaleLowerCase('ru')
          .includes(normalizedQuery),
      )
    : options;

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
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [isOpen]);

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
            {visibleOptions.length === 0 ? (
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
