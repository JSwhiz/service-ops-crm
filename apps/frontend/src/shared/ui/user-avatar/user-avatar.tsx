import React from "react";

const AVATAR_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#4f46e5",
] as const;

function getStableColor(value: string): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }

  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

function getInitial(fullName: string): string {
  return Array.from(fullName.trim())[0]?.toLocaleUpperCase("ru-RU") ?? "?";
}

export function UserAvatar({
  fullName,
  size = "medium",
}: {
  fullName: string;
  size?: "small" | "medium" | "large";
}): React.JSX.Element {
  return (
    <span
      className={`user-avatar user-avatar--${size}`}
      style={{ backgroundColor: getStableColor(fullName) }}
      aria-label={`Аватар: ${fullName}`}
      title={fullName}
    >
      {getInitial(fullName)}
    </span>
  );
}
