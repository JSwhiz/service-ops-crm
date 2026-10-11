import Link from 'next/link';
import React from 'react';

import styles from './registry-open-link.module.css';

export function RegistryOpenLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <Link className={styles.link} href={href} aria-label={label} title={label}>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
