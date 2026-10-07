interface AvailabilityWindowLabelInput {
  isUnavailable: boolean;
  availabilityMode: string | null;
  startDate: string | null;
  endDate: string | null;
  comment: string | null;
}

function formatDate(value: string, includeTime: boolean): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

export function getAvailabilityLabel(
  availability: AvailabilityWindowLabelInput,
): string | null {
  if (!availability.isUnavailable) return null;

  const includeTime = availability.availabilityMode !== 'full_day';
  const start = availability.startDate
    ? formatDate(availability.startDate, includeTime)
    : null;
  const end = availability.endDate
    ? formatDate(availability.endDate, includeTime)
    : null;
  const period = start
    ? end
      ? `${start} — ${end}`
      : `с ${start}; дата окончания не указана`
    : 'период не указан';
  const mode = includeTime ? 'Недоступен по времени' : 'Недоступен весь день';
  const reason = availability.comment?.trim();

  return `${mode}: ${period}.${reason ? ` Причина: ${reason}` : ''}`;
}
