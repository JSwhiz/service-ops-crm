import React from 'react';

import styles from './data-table.module.css';

export interface DataTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Accessible name for the scrollable table region and default caption. */
  label: string;
  /** Optional visible or screen-reader-only table caption. */
  caption?: React.ReactNode;
  /** Domain-specific class for column widths, cell renderers, and responsive behavior. */
  frameClassName?: string;
}

/** Shared visual and accessibility foundation for read-only registry tables. */
export function DataTable({
  label,
  caption,
  frameClassName,
  className,
  children,
  ...tableProps
}: DataTableProps): React.JSX.Element {
  return (
    <div className={[styles.frame, frameClassName].filter(Boolean).join(' ')} role="region" aria-label={label} tabIndex={0}>
      <table {...tableProps} className={[styles.table, className].filter(Boolean).join(' ')}>
        <caption className={styles.caption}>{caption ?? label}</caption>
        {children}
      </table>
    </div>
  );
}
