const objectNameCollator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

export function sortObjectOptions<T extends { id: string; name: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    objectNameCollator.compare(left.name, right.name) || left.id.localeCompare(right.id),
  );
}
