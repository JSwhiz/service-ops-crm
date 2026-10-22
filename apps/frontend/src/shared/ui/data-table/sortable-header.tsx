import React from 'react';

import styles from './data-table.module.css';

export type SortDirection = 'asc' | 'desc';

export interface SortableHeaderProps<Field extends string> {
  field: Field;
  label: string;
  sortBy: Field;
  sortDirection: SortDirection;
  onSort: (field: Field) => void;
  className?: string;
}

/** Column header that sorts the registry; exposes aria-sort on the <th>. */
export function SortableHeader<Field extends string>({
  field,
  label,
  sortBy,
  sortDirection,
  onSort,
  className,
}: SortableHeaderProps<Field>): React.JSX.Element {
  const active = sortBy === field;
  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={styles.sortButton}
        data-active={active ? 'true' : 'false'}
        title={`Сортировать по колонке «${label}»`}
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        <span className={styles.sortIndicator} data-direction={active ? sortDirection : 'none'} aria-hidden="true">
          <span className={styles.sortChevron} data-part="up" />
          <span className={styles.sortChevron} data-part="down" />
        </span>
      </button>
    </th>
  );
}
