'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUserAccess, previewUserAccess, saveUserAccess } from '@/entities/user-access/api/user-access-client';
import type { AccessAction, AccessCatalog, AccessChange, AccessDetail, AccessPayload, AccessPreview } from '@/entities/user-access/model/user-access.types';
import { useAuth } from '@/shared/auth/use-auth';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';
import { getUserRoleLabel } from '@/shared/lib/display-name';
import { Alert, Button, EmptyState, Field, LoadingState } from '@/shared/ui/foundation';
import { Dialog } from '@/shared/ui/overlays/overlays';
import { useConfirm } from '@/shared/ui/overlays/use-dialogs';
import { SearchField } from '@/shared/ui/search-field/search-field';
import { Select } from '@/shared/ui/searchable-select/select';
import { WorkspaceTabs } from '@/shared/ui/workspace-tabs/workspace-tabs';
import { AccessEntityPicker } from './access-entity-picker';
import { AccessRuleEditor } from './access-rule-editor';
import { changeAccessMode, initialAccessDraft, isValidManagementChange, managementScopes, updateAccessChanges } from '../model/access-management-scopes';
import { accessError, accessLabel, effectiveLabel, ruleLabel, scopeLabels } from './access-presentation';
import { AccessAssignmentsTab, AccessHistoryTab } from './user-access-context';
import styles from './user-access.module.css';

const tabs = [{ value: 'rights', label: 'Права' }, { value: 'assignments', label: 'Назначения' }, { value: 'history', label: 'История' }];
const approvalReadExplanation = 'Персональное разрешение может открыть выбранные или все чужие согласования только для просмотра. Оно не даёт права подтвердить, отклонить или отменить чужую заявку. Персональные запреты данных источника сохраняются.';
type Review = { payload: AccessPayload; result: AccessPreview };

export function UserAccessDialog({ userId, catalog, onClose, onSaved }: {
  userId: string; catalog: AccessCatalog; onClose: () => void; onSaved: () => void;
}): React.JSX.Element {
  const router = useRouter();
  const { refreshUser, capabilitiesRefreshError } = useAuth();
  const accessRevision = useAccessRevision();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [detail, setDetail] = useState<AccessDetail | null>(null);
  const [changes, setChanges] = useState<Record<string, AccessChange>>({});
  const [reason, setReason] = useState('');
  const [tab, setTab] = useState('rights');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [invalidAction, setInvalidAction] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const [confirm, confirmation] = useConfirm();
  const dirty = Object.keys(changes).length > 0 || Boolean(reason.trim());
  const tabPrefix = React.useId();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const initialTab = new URLSearchParams(window.location.search).get('accessTab');
    if (tabs.some((item) => item.value === initialTab)) setTab(initialTab!);
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError('');
    void getUserAccess(userId, controller.signal)
      .then((result) => {
        if (!active) return;
        setDetail(result); setReview(null); setConflict(false);
        setLoadedAccessRevision(accessRevision);
        if (refreshKey) setNotice('Серверные данные обновлены. Черновик сохранён для сравнения с текущими правами. Проверьте черновик и повторите просмотр изменений.');
      })
      .catch((cause: unknown) => { if (active) setError(accessError(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [userId, refreshKey, accessRevision]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!invalidAction) return;
    const row = bodyRef.current?.querySelector<HTMLElement>(`[data-access-action="${invalidAction}"]`);
    const group = row?.closest('details');
    if (group) group.open = true;
    (row?.querySelector<HTMLButtonElement>('button[name="accessScope"]') ?? row?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [invalidAction]);
  useEffect(() => { if (review) previewRef.current?.focus(); }, [review]);
  useEffect(() => {
    if (!review) return;
    const remaining = Date.parse(review.result.expiresAt) - Date.now();
    const expire = (): void => {
      if (operation.current) return;
      setReview(null);
      setNotice('Срок действия результата проверки истёк. Черновик сохранён; повторите просмотр изменений.');
    };
    if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [review]);
  useEffect(() => { if (reasonError && tab === 'rights') reasonRef.current?.focus(); }, [reasonError, tab]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);

  const allowExit = useCallback(async (): Promise<boolean> => {
    if (operation.current) return false;
    if (!dirty) return true;
    return confirm({ title: 'Закрыть без сохранения?', consequence: 'Черновик персональных правил и причина будут удалены.', confirmLabel: 'Закрыть без сохранения', tone: 'danger' });
  }, [confirm, dirty]);
  useEffect(() => {
    const followLink = (event: MouseEvent): void => {
      if ((!dirty && !operation.current) || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      void allowExit().then((allowed) => {
        if (!allowed || !mounted.current) return;
        onClose();
        if (url.origin === window.location.origin) router.push(`${url.pathname}${url.search}${url.hash}`);
        else window.location.assign(url.href);
      });
    };
    document.addEventListener('click', followLink, true);
    return () => document.removeEventListener('click', followLink, true);
  }, [allowExit, dirty, onClose, router]);

  const effectiveByCode = useMemo(() => new Map(detail?.effective.map((row) => [row.actionCode, row]) ?? []), [detail]);
  const rulesByCode = useMemo(() => new Map(detail?.rules.map((rule) => [rule.actionCode, rule]) ?? []), [detail]);
  const groups = useMemo(() => {
    const result = new Map<string, AccessAction[]>();
    const normalized = query.trim().toLocaleLowerCase('ru');
    for (const action of catalog.actions) {
      const row = effectiveByCode.get(action.code);
      if (filter === 'allowed' && row?.allowed !== true) continue;
      if (filter === 'denied' && row?.allowed !== false) continue;
      if (filter === 'partial' && row?.allowed !== null) continue;
      if (filter === 'personal' && !rulesByCode.has(action.code) && !changes[action.code]) continue;
      if (normalized && !`${action.name} ${action.description} ${action.code}`.toLocaleLowerCase('ru').includes(normalized)) continue;
      const group = result.get(action.module) ?? [];
      group.push(action); result.set(action.module, group);
    }
    return [...result];
  }, [catalog, changes, effectiveByCode, filter, query, rulesByCode]);
  const actionName = (code: string): string => catalog.actions.find((action) => action.code === code)?.name ?? 'Действие вне текущего каталога';
  const groupName = (module: string): string => catalog.actions.find((action) => action.code === `${module}.access`)?.name ?? 'Другие действия';

  const changeRule = (action: AccessAction, next: AccessChange): void => {
    setReview(null); setInvalidAction(''); setError(''); setNotice('');
    setChanges((current) => updateAccessChanges(current, next, rulesByCode.get(action.code)));
  };
  const showError = (cause: unknown): void => { setError(accessError(cause)); setConflict(true); };
  const reloadDetail = (): void => {
    if (operation.current) return;
    setReview(null); setLoading(true); setRefreshKey((value) => value + 1);
  };
  const requestPreview = async (): Promise<void> => {
    if (!detail || loading || operation.current || loadedAccessRevision !== accessRevision) return;
    setError(''); setReasonError(''); setInvalidAction(''); setTab('rights');
    if (!reason.trim()) { setReasonError('Укажите причину изменения прав.'); reasonRef.current?.focus(); return; }
    const edits = Object.values(changes);
    if (!edits.length) { setError('Измените хотя бы одно персональное правило.'); return; }
    if (edits.length > 300) { setError('За один раз можно изменить не больше 300 правил.'); return; }
    const invalid = edits.find((change) => {
      const action = catalog.actions.find((item) => item.code === change.actionCode);
      return !action || !isValidManagementChange(action, change);
    });
    if (invalid) {
      setInvalidAction(invalid.actionCode); setQuery(''); setFilter('all'); setError(`Проверьте область и выбранные записи для действия «${actionName(invalid.actionCode)}».`); return;
    }
    const payload = { expectedVersion: detail.accessVersion, reason: reason.trim(), changes: edits };
    operation.current = true; setBusy(true); setReview(null);
    try {
      const result = await previewUserAccess(userId, payload);
      if (mounted.current) setReview({ payload: { ...payload, changes: result.changes }, result });
    } catch (cause) { if (mounted.current) showError(cause); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };
  const save = async (): Promise<void> => {
    if (!review || !detail || loading || operation.current || loadedAccessRevision !== accessRevision) return;
    if (review.result.expectedVersion !== detail.accessVersion || !Number.isFinite(Date.parse(review.result.expiresAt)) || Date.parse(review.result.expiresAt) <= Date.now()) { setReview(null); setError('Результат проверки устарел. Повторите просмотр изменений.'); return; }
    operation.current = true; setBusy(true); setError('');
    try {
      const result = await saveUserAccess(userId, review.payload, review.result);
      if (!mounted.current) return;
      setDetail((current) => current ? { ...current, ...result, user: { ...current.user, accessVersion: result.accessVersion }, sources: { ...current.sources, rules: result.rules } } : null);
      setChanges({}); setReason(''); setReview(null); setConflict(false);
      setNotice('Права сохранены. Серверный результат и история изменений доступны в этом окне.'); onSaved();
      try { await refreshUser({ force: true }); }
      catch { if (mounted.current) setNotice('Права сохранены на сервере, но обновить права текущей сессии не удалось. Повторите обновление сессии; сохранять изменения повторно не требуется.'); }
    } catch (cause) { if (mounted.current) { setReview(null); showError(cause); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  return <>
    {loadedAccessRevision !== accessRevision ? <div role="status">{error || 'Обновляем доступ к сведениям пользователя…'}{error ? <Button disabled={busy || loading} onClick={reloadDetail}>Повторить проверку доступа</Button> : null}</div> : null}
    <AccessSnapshotBoundary blocked={loadedAccessRevision !== accessRevision}>
    <Dialog open title={detail?.user.fullName || 'Пользователь и доступы'} size="wide" busy={busy}
      description={detail ? `${detail.user.login} · ${detail.user.isActive ? 'Активен' : 'Неактивен'} · ${detail.user.roleCodes.map(getUserRoleLabel).join(', ')}` : 'Загрузка данных пользователя…'}
      onOpenChange={(open) => { if (!open) void allowExit().then((allowed) => { if (allowed) onClose(); }); }}
      footer={<div className={styles.footer}>
        <span className="ui-text-muted">{Object.keys(changes).length ? `Правил в черновике: ${Object.keys(changes).length}` : 'Несохранённых правил нет'}</span>
        <Button variant="ghost" disabled={busy} onClick={() => { void allowExit().then((allowed) => { if (allowed) onClose(); }); }}>Закрыть</Button>
        {review ? <Button variant="primary" pending={busy} disabled={loading} pendingLabel="Сохранение…" onClick={() => void save()}>Сохранить права</Button> : <Button variant="primary" pending={busy} pendingLabel="Проверка изменений…" disabled={loading || !detail || !catalog.actions.length} onClick={() => void requestPreview()}>Проверить изменения</Button>}
      </div>}
    >
      <div className={`${styles.stack} ${styles.dialogBody}`} ref={bodyRef}>
        {error ? <div ref={errorRef} tabIndex={-1}><Alert tone="danger" role="alert" action={conflict || !detail ? <Button disabled={busy || loading} onClick={reloadDetail}>Обновить данные для сравнения</Button> : undefined}>{error}</Alert></div> : null}
        {notice ? <Alert tone="info" role="status">{notice}</Alert> : null}
        {capabilitiesRefreshError ? <Alert tone="warning" role="status" action={<Button disabled={busy} onClick={() => { void refreshUser({ force: true }).catch(() => undefined); }}>Обновить права сессии</Button>}>{capabilitiesRefreshError}</Alert> : null}
        {loading ? <LoadingState label="Загрузка прав пользователя…" /> : null}
        {detail ? <>
          <WorkspaceTabs items={tabs} value={tab} onChange={(next) => {
            setTab(next);
            const params = new URLSearchParams(window.location.search);
            params.set('accessTab', next);
            window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}${window.location.hash}`);
          }} label="Разделы доступа пользователя" idPrefix={tabPrefix} />
          <div role="tabpanel" hidden={tab !== 'rights'} id={`${tabPrefix}-panel-rights`} aria-labelledby={`${tabPrefix}-tab-rights`} className={styles.stack}>
            <Alert tone="info">Каталог зарегистрирован в серверной политике. Это не подтверждает подключение всех действий и каналов. Персональное правило не отменяет согласования, ограничения статуса и денежные правила.</Alert>
            <div className={styles.filters}>
              <SearchField label="Поиск права в полном каталоге" placeholder="Название права или действия…" value={query} onChange={setQuery} />
              <Select aria-label="Фильтр действующих прав" value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">Все права</option><option value="allowed">Разрешено</option><option value="denied">Запрещено</option><option value="partial">Зависит от записи</option><option value="personal">Персональные изменения</option>
              </Select>
            </div>
            <details><summary>Источники доступа пользователя</summary>
              <h3 className="ui-section-title">Роли</h3><ul>{detail.sources.roles.map((role) => <li key={role.code}>{role.name || getUserRoleLabel(role.code)}</li>)}</ul>
              <h3 className="ui-section-title">Прежние персональные права</h3>{detail.sources.userPermissions.length ? <ul>{detail.sources.userPermissions.map((permission) => <li key={permission.code}>{permission.name} · {permission.effect === 'deny' ? 'Запрет' : 'Разрешение'}</li>)}</ul> : <p>Прежних персональных прав нет.</p>}
              <p>Назначения и временные замещения показаны на отдельной вкладке; они не меняют системную роль.</p>
            </details>
            {!catalog.actions.length ? <EmptyState title="Каталог прав пуст" description="Сервер не вернул действия для управления. Изменение прав недоступно." /> : !groups.length ? <EmptyState title="Права не найдены" description="Измените запрос или фильтр." action={<Button onClick={() => { setQuery(''); setFilter('all'); }}>Сбросить фильтры</Button>} /> : groups.map(([module, actions]) => <details className={styles.group} key={module} open={Boolean(query.trim()) || filter !== 'all' ? true : undefined}>
              <summary>{groupName(module)} · {actions.length}</summary>
              {actions.map((action) => {
                const row = effectiveByCode.get(action.code);
                const original = rulesByCode.get(action.code);
                const supportedScopes = managementScopes(action);
                const initialDraft = initialAccessDraft(action, original);
                if (!initialDraft) return <Alert key={action.code} tone="warning" title={action.name}>Каталог не передал поддерживаемые области. Изменение этого права недоступно.</Alert>;
                const draft = changes[action.code] ?? initialDraft;
                const legacyScope = original && !supportedScopes.includes(original.scope) ? original.scope : null;
                return <div key={action.code} data-access-action={action.code}>
                  <AccessRuleEditor title={action.name} description={action.description === action.name ? undefined : action.description}
                    effectiveResult={effectiveLabel(row)} source={row ? accessLabel(row.source) : 'Источник не получен'} effectiveScope={row?.scope ? scopeLabels[row.scope] : 'Определяется действующими правилами и записью'}
                    constraints={<div className={styles.stack}>
                      {action.code === 'approvals.read' ? <p className={styles.reason}>{approvalReadExplanation}</p> : null}
                      {action.integrationStatus === 'policy_contract' ? <p className={styles.reason}>Зарегистрировано в контракте политики. Подключение всех каналов этого действия не подтверждено.</p> : null}
                      {[...new Set([...(row?.warnings ?? []), ...(action.constraint ? [action.constraint] : []), ...(action.invariants ?? [])])].map((warning) => <p key={warning} className={styles.reason}>{accessLabel(warning)}</p>)}
                      {row?.baseline ? <details>
                        <summary>Исходный доступ до персонального правила</summary>
                        <p>{row.baseline.allowed ? 'Разрешено при выполнении действующих условий' : 'Не разрешено'} · {row.baseline.scopes.map((scope) => scopeLabels[scope]).join(', ')}</p>
                        <p>Источник: {accessLabel(row.baseline.source)}</p>
                        {row.baseline.conditions.length ? <ul>{row.baseline.conditions.map((condition) => <li key={condition}>{accessLabel(condition)}</li>)}</ul> : null}
                      </details> : null}
                      {action.parentAction ? <p className={styles.reason}>Родительское право: {actionName(action.parentAction)}</p> : null}
                      {action.delegation === 'object_only' ? <p className={styles.reason}>Замещение действует только в выбранных объектах и в пределах срока.</p> : null}
                    </div>}
                    editable={action.manageable} unavailableReason={action.constraint ? accessLabel(action.constraint) : undefined}
                    mode={draft.effect} hasPersonalRule={Boolean(original)} scope={draft.scope} supportedScopes={supportedScopes.map((value) => ({ value, label: scopeLabels[value] }))} pending={busy || loading}
                    legacyScopeLabel={legacyScope ? scopeLabels[legacyScope] : undefined}
                    legacyScopeUnchanged={Boolean(legacyScope && !changes[action.code])}
                    onModeChange={(effect) => changeRule(action, changeAccessMode(action, draft, effect, original))}
                    onScopeChange={(scope) => changeRule(action, { ...draft, scope, selectedIds: scope === 'selected' ? draft.selectedIds : [] })}
                    selectedEntitiesControl={<AccessEntityPicker resourceType={action.resourceType} ids={draft.selectedIds} onChange={(selectedIds) => changeRule(action, { ...draft, selectedIds })} disabled={busy || loading} />}
                    error={invalidAction === action.code ? 'Проверьте поддержку области и выберите хотя бы одну запись для режима «Выбранные».' : undefined}
                  />
                  <details><summary>Технические сведения права</summary><p>{action.code} · зарегистрировано в policy-контракте</p><p>{(row?.warnings ?? []).join(', ')}</p>{row?.baseline ? <pre className={styles.technical}>{JSON.stringify(row.baseline, null, 2)}</pre> : null}</details>
                </div>;
              })}
            </details>)}
            <Field label="Причина изменения прав" required error={reasonError} description="Причина сохраняется в истории вместе с точными изменениями.">
              <textarea ref={reasonRef} name="accessChangeReason" autoComplete="off" rows={3} maxLength={2000} value={reason} disabled={busy || loading}
                onChange={(event) => { setReason(event.target.value); setReview(null); setReasonError(''); }} />
            </Field>
            {review ? <section ref={previewRef} tabIndex={-1} className={styles.preview} aria-label="Просмотр изменений, проверенных сервером">
              <h3 className="ui-section-title">Просмотр изменений</h3>
              <p>Версия {review.result.expectedVersion}. Действует до {new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', timeStyle: 'short' }).format(new Date(review.result.expiresAt))} по Москве.</p>
              <p>Причина: {review.payload.reason}</p>
              {review.result.changes.some((change) => change.actionCode === 'approvals.read') || review.result.effective.some((row) => row.actionCode === 'approvals.read' && JSON.stringify(row) !== JSON.stringify(effectiveByCode.get(row.actionCode))) ? <p>{approvalReadExplanation}</p> : null}
              {review.result.warnings.length ? <Alert tone="warning"><ul>{review.result.warnings.map((warning) => <li key={warning}>{accessLabel(warning)}</li>)}</ul></Alert> : null}
              <ul className={styles.changes}>{review.result.changes.map((change) => {
                const after = review.result.effective.find((row) => row.actionCode === change.actionCode);
                return <li key={change.actionCode}><strong>{actionName(change.actionCode)}</strong>
                  <span>Правило: {ruleLabel(rulesByCode.get(change.actionCode))} → {ruleLabel(after?.rule)}</span>
                  <span>Действующий доступ: {effectiveLabel(effectiveByCode.get(change.actionCode))} → {effectiveLabel(after)}</span>
                  <span>Источник по результату проверки: {after ? accessLabel(after.source) : 'Не получен'}</span>
                  <details><summary>Точные выбранные записи и правило</summary><pre className={styles.technical}>{JSON.stringify(change, null, 2)}</pre></details>
                </li>;
              })}</ul>
              <details><summary>Другие затронутые права по серверному результату</summary><ul>{review.result.effective.filter((row) => !review.result.changes.some((change) => change.actionCode === row.actionCode) && JSON.stringify(row) !== JSON.stringify(effectiveByCode.get(row.actionCode))).map((row) => <li key={row.actionCode}>{actionName(row.actionCode)}: {effectiveLabel(effectiveByCode.get(row.actionCode))} → {effectiveLabel(row)}. {row.warnings.map(accessLabel).join(' ')}</li>)}</ul></details>
            </section> : null}
          </div>
          <div role="tabpanel" hidden={tab !== 'assignments'} id={`${tabPrefix}-panel-assignments`} aria-labelledby={`${tabPrefix}-tab-assignments`}>{tab === 'assignments' ? <AccessAssignmentsTab detail={detail} /> : null}</div>
          <div role="tabpanel" hidden={tab !== 'history'} id={`${tabPrefix}-panel-history`} aria-labelledby={`${tabPrefix}-tab-history`}>{tab === 'history' ? <AccessHistoryTab userId={userId} version={detail.accessVersion} actions={catalog.actions} /> : null}</div>
        </> : null}
      </div>
    </Dialog>
    {confirmation}
    </AccessSnapshotBoundary>
  </>;
}
