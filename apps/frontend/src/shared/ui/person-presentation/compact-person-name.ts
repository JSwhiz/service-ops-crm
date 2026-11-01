export function compactPersonName(value: string): string {
  const [surname, ...names] = value.trim().split(/\s+/);
  return names.length ? `${surname} ${names.map((name) => `${Array.from(name)[0]}.`).join('')}` : value;
}
