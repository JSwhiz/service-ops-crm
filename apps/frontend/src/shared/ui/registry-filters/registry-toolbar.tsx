'use client';

import React, { useEffect, useRef, useState } from 'react';

import { usePopoverPlacement } from '@/shared/ui/searchable-select/use-popover-placement';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { SearchField } from '@/shared/ui/search-field/search-field';

import styles from './registry-toolbar.module.css';

import { ChevronDownIcon, PlusIcon } from '@/shared/ui/icons/icons';

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
  const popoverAnchorRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const menuOpen = Boolean(openFilterId) || addMenuOpen;
  const popoverPlacement = usePopoverPlacement(menuOpen, popoverAnchorRef, popoverRef, 420);
  const popoverStyle = {
    '--registry-menu-max-height': `${popoverPlacement.availableHeight}px`,
  } as React.CSSProperties;

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
      {showSearch ? (
        <SearchField
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          label={searchLabel}
        />
      ) : null}

      <div className={styles.filters} aria-label="Фильтры списка">
        {activeFilters.map((filter) => {
          const selectedLabel = filter.options.find((option) => option.value === filter.value)?.label ?? filter.value;
          const isOpen = openFilterId === filter.id;

          return (
            <div
              className={styles.filterControl}
              key={filter.id}
              ref={isOpen ? popoverAnchorRef : undefined}
            >
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
                <ChevronDownIcon />
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
                <div
                  className={styles.filterDropdown}
                  role="listbox"
                  aria-label={filter.label}
                  data-placement={popoverPlacement.placement}
                  ref={popoverRef}
                  style={popoverStyle}
                >
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

        <div className={styles.addFilterRoot} ref={addMenuOpen ? popoverAnchorRef : undefined}>
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
            <PlusIcon />
            <span>{availableFilters.length > 0 ? 'Добавить фильтр' : 'Все фильтры добавлены'}</span>
          </button>

          {addMenuOpen && availableFilters.length > 0 ? (
            <div
              className={styles.addFilterMenu}
              role="menu"
              data-placement={popoverPlacement.placement}
              ref={popoverRef}
              style={popoverStyle}
            >
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
                      <span className={styles.addFilterOptionIcon}><PlusIcon /></span>
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

/** «с … — по …» control for a period filter (use as `customControl`). */
export function RegistryDateRange({
  label,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  label?: string;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className={styles.dateRange}>
      {label ? <span className={styles.filterLabel}>{label}</span> : null}
      <DatePicker aria-label={`${label ?? 'Период'}: с`} placeholder="с" displayFormat="short" max={to || undefined} value={from} onChange={onFromChange} />
      <span className={styles.dateDash} aria-hidden="true">—</span>
      <DatePicker aria-label={`${label ?? 'Период'}: по`} placeholder="по" displayFormat="short" min={from || undefined} value={to} onChange={onToChange} />
    </div>
  );
}
