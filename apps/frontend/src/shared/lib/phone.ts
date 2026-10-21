/** Formats Russian mobile numbers as «+7 900 000-00-00»; other input is returned as typed. */
export function formatPhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  return value;
}

/** `tel:` link for a phone, or null when the value is too short to dial. */
export function getPhoneHref(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `tel:+7${digits.slice(1)}`;
  }
  return digits.length >= 5 ? `tel:${digits}` : null;
}
