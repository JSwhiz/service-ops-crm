'use client';

import React, { forwardRef } from 'react';

import { IconButton } from '@/shared/ui/foundation';

import { AttachmentIcon } from './attachment-icon';
import styles from './attachment-trigger.module.css';

export const AttachmentTrigger = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { 'aria-label'?: string }>(function AttachmentTrigger({
  className,
  'aria-label': ariaLabel = 'Прикрепить фото или файл',
  title = 'Прикрепить фото или файл',
  ...props
}, ref): React.JSX.Element {
  return (
    <IconButton
      ref={ref}
      {...props}
      aria-label={ariaLabel}
      title={title}
      className={[styles.trigger, className].filter(Boolean).join(' ')}
    >
      <AttachmentIcon />
    </IconButton>
  );
});
