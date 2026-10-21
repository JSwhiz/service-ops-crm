'use client';

import React, { useId } from 'react';

import styles from './table-pagination.module.css';
import { Select } from '@/shared/ui/searchable-select/select';

export interface TablePaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  summary?: React.ReactNode;
  pending?: boolean;
  label?: string;
  /** Rows per page; the size selector renders when `onPageSizeChange` is set. */
  pageSize?: number;
  pageSizeOptions?: ReadonlyArray<number>;
  onPageSizeChange?: (pageSize: number) => void;
}

/** Shared footer/navigation pattern for paginated registries and table sections. */
export function TablePagination({
  page,
  totalPages,
  onPageChange,
  summary,
  pending = false,
  label = 'Страницы таблицы',
  pageSize,
  pageSizeOptions = [25, 50, 100],
  onPageSizeChange,
}: TablePaginationProps): React.JSX.Element {
  const sizeId = useId();
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const sizes = pageSize && !pageSizeOptions.includes(pageSize)
    ? [...pageSizeOptions, pageSize].sort((left, right) => left - right)
    : pageSizeOptions;

  return (
    <nav className={styles.pagination} aria-label={label} aria-busy={pending}>
      <div className={styles.summary}>{summary}</div>
      <div className={styles.navigation}>
        {onPageSizeChange && pageSize ? (
          <div className={styles.pageSize}>
            <span id={sizeId}>Строк на странице</span>
            <Select
              aria-label="Строк на странице"
              className={styles.pageSizeSelect}
              value={String(pageSize)}
              disabled={pending}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </Select>
          </div>
        ) : null}
        <button type="button" disabled={pending || safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          Назад
        </button>
        <span className={styles.pageNumber} aria-current="page">Страница {safePage} из {safeTotalPages}</span>
        <button type="button" disabled={pending || safePage >= safeTotalPages} onClick={() => onPageChange(safePage + 1)}>
          Далее
        </button>
      </div>
    </nav>
  );
}
