'use client';

import React, { useEffect, useRef, useState } from 'react';

import styles from './registry-toolbar.module.css';

export interface RegistryFilterOption {
  value: string;
  label: string;
}

export interface ActiveRegistryFilter {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<RegistryFilterOption>;
  onChange: (value: string) => void;
  onRemove: () => void;
  customControl?: React.ReactNode;
}

export interface AvailableRegistryFilter {
  id: string;
  label: string;
  options: ReadonlyArray<RegistryFilterOption>;
  onAdd: (value: string) => void;
}

interface RegistryToolbarProps {
  showSearch?: boolean;
  searchValue: string;
  searchLabel: string;
  searchPlaceholder: string;
  onSearchChange: (value: string) => void;
  activeFilters: ReadonlyArray<ActiveRegistryFilter>;
  availableFilters: ReadonlyArray<AvailableRegistryFilter>;
  actions?: React.ReactNode;
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function RegistryPlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function RegistryToolbar({
  showSearch = true,
  searchValue,
  searchLabel,
  searchPlaceholder,
  onSearchChange,
  activeFilters,
  availableFilters,
  actions,
}: RegistryToolbarProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  useEffect(() => {
    if (!openFilterId && !addMenuOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenFilterId(null);
        setAddMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenFilterId(null);
        setAddMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [addMenuOpen, openFilterId]);

  return (
    <div className={styles.toolbar} data-search={showSearch ? 'true' : 'false'} ref={rootRef}>
      {showSearch ? <div className={styles.searchBox} data-active={searchValue ? 'true' : 'false'}>
        <SearchIcon />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
        />
        {searchValue ? (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => onSearchChange('')}
            aria-label="Очистить поиск"
            title="Очистить поиск"
          >
            ×
          </button>
        ) : null}
      </div> : null}

      <div className={styles.filters} aria-label="Фильтры списка">
        {activeFilters.map((filter) => {
          const selectedLabel = filter.options.find((option) => option.value === filter.value)?.label ?? filter.value;
          const isOpen = openFilterId === filter.id;

          return (
            <div className={styles.filterControl} key={filter.id}>
              {filter.customControl ? (
                <div className={styles.customFilterControl}>{filter.customControl}</div>
              ) : <button
                type="button"
                className={styles.filterTrigger}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => {
                  setAddMenuOpen(false);
                  setOpenFilterId(isOpen ? null : filter.id);
                }}
              >
                <span className={styles.filterCopy}>
                  <span className={styles.filterLabel}>{filter.label}</span>
                  <strong>{selectedLabel}</strong>
                </span>
                <ChevronIcon />
              </button>}
              <button
                type="button"
                className={styles.filterRemove}
                aria-label={`Удалить фильтр «${filter.label}»`}
                title="Удалить фильтр"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.currentTarget.blur();
                  setOpenFilterId(null);
                  filter.onRemove();
                }}
              >
                ×
              </button>
              {isOpen ? (
                <div className={styles.filterDropdown} role="listbox" aria-label={filter.label}>
                  <div className={styles.dropdownLabel}>{filter.label}</div>
                  {filter.options.map((option) => {
                    const selected = option.value === filter.value;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={styles.filterOption}
                        data-selected={selected ? 'true' : 'false'}
                        key={option.value}
                        onClick={() => {
                          filter.onChange(option.value);
                          setOpenFilterId(null);
                        }}
                      >
                        <span>{option.label}</span>
                        {selected ? <span className={styles.filterCheck} aria-hidden="true">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className={styles.addFilterRoot}>
          <button
            type="button"
            className={styles.addFilterButton}
            disabled={availableFilters.length === 0}
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            onClick={() => {
              setOpenFilterId(null);
              setAddMenuOpen((value) => !value);
            }}
          >
            <RegistryPlusIcon />
            <span>{availableFilters.length > 0 ? 'Добавить фильтр' : 'Все фильтры добавлены'}</span>
          </button>

          {addMenuOpen && availableFilters.length > 0 ? (
            <div className={styles.addFilterMenu} role="menu">
              {availableFilters.map((filter) => (
                <div className={styles.addFilterSection} key={filter.id}>
                  <div className={styles.dropdownLabel}>{filter.label}</div>
                  {filter.options.map((option) => (
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.addFilterOption}
                      key={option.value}
                      onClick={() => {
                        filter.onAdd(option.value);
                        setAddMenuOpen(false);
                      }}
                    >
                      <span className={styles.addFilterOptionIcon}><RegistryPlusIcon /></span>
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
    </div>
  );
}
