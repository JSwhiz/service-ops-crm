import React from 'react';

import styles from './user-avatar.module.css';

const AVATAR_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0d9488',
  '#0891b2',
  '#4f46e5',
] as const;

function getStableColor(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** Two letters for people records («Иванов Пётр» → «ИП»), one for system users. */
export function getInitials(fullName: string, letters: 1 | 2 = 2): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const value = letters === 1
    ? (Array.from(fullName.trim())[0] ?? '')
    : (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return value.toLocaleUpperCase('ru-RU') || '?';
}

export interface UserAvatarProps {
  fullName: string;
  size?: 'small' | 'medium' | 'large';
  /**
   * `colored` — stable colour per system user (header, chats);
   * `soft` — neutral accent tint for staff and candidate records.
   */
  variant?: 'colored' | 'soft';
  /** Decorative next to a visible name. */
  decorative?: boolean;
}

export function UserAvatar({
  fullName,
  size = 'medium',
  variant = 'colored',
  decorative = false,
}: UserAvatarProps): React.JSX.Element {
  return (
    <span
      // `user-avatar` is a stable hook for layouts that align avatars (chats).
      className={['user-avatar', styles.avatar, styles[size], variant === 'soft' && styles.soft].filter(Boolean).join(' ')}
      style={variant === 'colored' ? { backgroundColor: getStableColor(fullName) } : undefined}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Аватар: ${fullName}`}
      title={decorative ? undefined : fullName}
    >
      {getInitials(fullName, variant === 'colored' ? 1 : 2)}
    </span>
  );
}
