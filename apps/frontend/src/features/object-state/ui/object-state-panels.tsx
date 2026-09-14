import React from 'react';

import styles from '@/features/object-shared-ui/object-surfaces.module.css';

export function ObjectPanelLoading({
  title,
}: {
  title: string;
}): React.JSX.Element {
  return (
    <div className={styles.surfaceCompact} aria-busy="true">
      <div className={styles.recordTitle}>{title}</div>
      <div className={styles.muted}>Загрузка...</div>
    </div>
  );
}

export function ObjectPanelError({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.JSX.Element {
  return (
    <div className={styles.surfaceCompact}>
      <div className={styles.recordTitle}>{title}</div>
      <div className={styles.error} role="alert">{message}</div>
    </div>
  );
}
