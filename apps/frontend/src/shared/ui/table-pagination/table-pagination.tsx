'use client';

import React from 'react';

import styles from './table-pagination.module.css';

export interface TablePaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  summary?: React.ReactNode;
  pending?: boolean;
  label?: string;
  beforeNavigation?: React.ReactNode;
}

/** Shared footer/navigation pattern for paginated registries and table sections. */
export function TablePagination({
  page,
  totalPages,
  onPageChange,
  summary,
  pending = false,
  label = 'Страницы таблицы',
  beforeNavigation,
}: TablePaginationProps): React.JSX.Element {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);

  return (
    <nav className={styles.pagination} aria-label={label} aria-busy={pending}>
      <div className={styles.summary}>{summary}</div>
      <div className={styles.navigation}>
        {beforeNavigation ? <div className={styles.beforeNavigation}>{beforeNavigation}</div> : null}
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
