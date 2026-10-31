// Database IDs are canonical UUID-shaped hex strings; seeded IDs need not carry RFC version bits.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID = new RegExp(`^${UUID}$`, 'i');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Accept only known in-app notification routes with validated identifiers and parameters. */
export function getSafeLocalTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value !== value.trim() || value.includes('\\') || [...value].some((char) => char.charCodeAt(0) < 32)) return null;
  let url: URL;
  try { url = new URL(value, 'https://crm.invalid'); } catch { return null; }
  if (url.origin !== 'https://crm.invalid' || url.pathname !== value.split(/[?#]/, 1)[0]) return null;

  const object = new RegExp(`^/objects/(${UUID})$`, 'i').exec(url.pathname);
  if (object) {
    const keys = [...url.searchParams.keys()];
    if (keys.length === 0) return ['', '#today', '#planning', '#reports'].includes(url.hash) ? value : null;
    if (keys.length === 2 && keys.includes('reportDate') && keys.includes('reportId') && isDateKey(url.searchParams.get('reportDate') ?? '') && ID.test(url.searchParams.get('reportId') ?? '') && url.hash === '#reports') return value;
    return null;
  }

  const order = new RegExp(`^/one-time-orders/(${UUID})$`, 'i').exec(url.pathname);
  if (order) return [...url.searchParams.keys()].length === (url.searchParams.has('section') ? 1 : 0)
    && (!url.searchParams.has('section') || url.searchParams.get('section') === 'execution') && !url.hash ? value : null;

  for (const route of ['candidates', 'employees'] as const) {
    if (new RegExp(`^/${route}/(${UUID})$`, 'i').test(url.pathname) && !url.search && !url.hash) return value;
  }
  if (url.pathname === '/tasks' && [...url.searchParams.keys()].length === 1 && ID.test(url.searchParams.get('taskId') ?? '') && !url.hash) {
    return `/tasks/${url.searchParams.get('taskId')}`;
  }
  if (new RegExp(`^/tasks/(${UUID})$`, 'i').test(url.pathname) && !url.search && !url.hash) return value;
  if (url.pathname === '/chats' && [...url.searchParams.keys()].length === 1 && ID.test(url.searchParams.get('roomId') ?? '') && !url.hash) return value;
  if (url.pathname === '/visit-plans' && [...url.searchParams.keys()].length === 2 && isDateKey(url.searchParams.get('date') ?? '') && ID.test(url.searchParams.get('managerUserId') ?? '') && !url.hash) return value;
  return null;
}

export function getChatSystemTarget(metadata: Record<string, unknown> | null): { href: string; label: string } | null {
  if (!metadata) return null;
  if (metadata.targetUrl != null && !getSafeLocalTarget(metadata.targetUrl)) return null;

  if (typeof metadata.budgetAlertId === 'string') {
    if (typeof metadata.objectId !== 'string') return null;
    const objectHref = getSafeLocalTarget(`/objects/${encodeURIComponent(metadata.objectId)}`);
    if (!objectHref) return null;
    const explicit = metadata.targetUrl == null ? `${objectHref}#planning` : getSafeLocalTarget(metadata.targetUrl);
    if (!explicit || new URL(explicit, 'https://crm.invalid').pathname !== objectHref) return null;
    return { href: explicit, label: 'Открыть бюджет объекта' };
  }

  if (typeof metadata.oneTimeOrderId === 'string') {
    const href = getSafeLocalTarget(`/one-time-orders/${encodeURIComponent(metadata.oneTimeOrderId)}`);
    if (!href) return null;
    if (metadata.targetUrl != null) {
      const explicit = getSafeLocalTarget(metadata.targetUrl);
      if (!explicit || new URL(explicit, 'https://crm.invalid').pathname !== href) return null;
      return { href: explicit, label: 'Открыть разовый заказ' };
    }
    return { href, label: 'Открыть разовый заказ' };
  }
  if (typeof metadata.objectId === 'string' && typeof metadata.reportId !== 'string') {
    const href = getSafeLocalTarget(`/objects/${encodeURIComponent(metadata.objectId)}`);
    if (!href) return null;
    if (metadata.targetUrl != null) {
      const explicit = getSafeLocalTarget(metadata.targetUrl);
      if (!explicit || new URL(explicit, 'https://crm.invalid').pathname !== href) return null;
      return { href: explicit, label: 'Открыть объект' };
    }
    return { href, label: 'Открыть объект' };
  }

  if (typeof metadata.objectId === 'string' && typeof metadata.reportId === 'string') {
    const href = getSafeLocalTarget(metadata.targetUrl);
    const objectHref = getSafeLocalTarget(`/objects/${encodeURIComponent(metadata.objectId)}`);
    if (!href || !objectHref || !ID.test(metadata.reportId)) return null;
    const parsed = new URL(href, 'https://crm.invalid');
    if (parsed.pathname !== objectHref || parsed.hash !== '#reports') return null;
    if (parsed.search) {
      const targetDate = parsed.searchParams.get('reportDate') ?? '';
      if (parsed.searchParams.get('reportId') !== metadata.reportId || !isDateKey(targetDate)
        || (typeof metadata.reportDate === 'string' && metadata.reportDate !== targetDate)) return null;
      return { href, label: 'Открыть отчёт' };
    }
    return { href, label: 'Открыть отчёты объекта' };
  }

  if (metadata.entityType === 'object' && typeof metadata.entityId === 'string') {
    const href = getSafeLocalTarget(`/objects/${encodeURIComponent(metadata.entityId)}`);
    return href ? { href, label: 'Открыть объект' } : null;
  }
  if (metadata.entityType === 'one_time_order' && typeof metadata.entityId === 'string') {
    const href = getSafeLocalTarget(`/one-time-orders/${encodeURIComponent(metadata.entityId)}`);
    return href ? { href, label: 'Открыть разовый заказ' } : null;
  }

  const explicitTarget = getSafeLocalTarget(metadata.targetUrl);
  if (!explicitTarget) return null;
  return { href: explicitTarget, label: 'Открыть' };
}
