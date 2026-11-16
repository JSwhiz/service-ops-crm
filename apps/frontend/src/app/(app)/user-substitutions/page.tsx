'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';

import { createUserSubstitution, getSubstitutionOptions, listUserSubstitutions, revokeUserSubstitution, type SubstitutionList, type SubstitutionObject, type UserSubstitution } from '@/entities/user-substitution/api/user-substitution-client';
import { Alert, Badge, Button, Field, PageHeader } from '@/shared/ui/foundation';
import { Dialog, ReasonDialog, useConfirm } from '@/shared/ui/overlays';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';

import styles from './user-substitutions.module.css';
import { DatePicker } from '@/shared/ui/date-picker/date-picker';
import { PlusIcon } from '@/shared/ui/icons/icons';
import { useCreateDraft } from '@/shared/drafts';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { isSavedWithoutAccess } from '@/shared/api/saved-without-access';
import { useAuth } from '@/shared/auth/use-auth';

const STATUS_LABELS = { active: 'Действует', scheduled: 'Запланировано', expired: 'Завершено', revoked: 'Прекращено' };
function moscowDateTime(value: Date): string {
  return new Date(value.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
function formatPeriod(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Не удалось выполнить действие.'; }

export default function UserSubstitutionsPage(): React.JSX.Element {
  const accessRevision = useAccessRevision();
  const { user } = useAuth();
  const [savedWithoutAccess, setSavedWithoutAccess] = useState(false);
  const [list, setList] = useState<SubstitutionList | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draft = useCreateDraft('user-substitution-create', {
    open: false, principal: '', principalOption: null as SearchableSelectOption | null, replacement: '', selected: [] as SubstitutionObject[], startNow: true,
    startsAt: '', endsAt: '', reason: '', initialStartsAt: '', initialEndsAt: '', replacementOption: null as SearchableSelectOption | null,
  });
  const { open, principal, replacement, selected, startNow, startsAt, endsAt, reason } = draft.value;
  const [confirmDiscard, confirmDialog] = useConfirm();
  const submitLock = useRef(false);
  const userOptions = useRef(new Map<string, SearchableSelectOption>());
  const setField = <K extends keyof typeof draft.value>(key: K, next: React.SetStateAction<typeof draft.value[K]>): void => {
    const value = { ...draft.value, [key]: typeof next === 'function' ? (next as (value: typeof draft.value[K]) => typeof draft.value[K])(draft.value[key]) : next };
    draft.setValue(value);
    draft.setDirty(Boolean(value.replacement || value.selected.length || value.reason || !value.startNow || value.startsAt !== value.initialStartsAt || value.endsAt !== value.initialEndsAt));
  };
  const setReplacement = (value: string): void => {
    draft.setValue((current) => ({ ...current, replacement: value, replacementOption: userOptions.current.get(value) ?? null }));
    draft.setDirty(Boolean(value || selected.length || reason || !startNow || startsAt !== draft.value.initialStartsAt || endsAt !== draft.value.initialEndsAt));
  };
  const setSelected: React.Dispatch<React.SetStateAction<SubstitutionObject[]>> = (value) => setField('selected', value);
  const setStartNow = (value: boolean): void => setField('startNow', value);
  const setStartsAt = (value: string): void => setField('startsAt', value);
  const setEndsAt = (value: string): void => setField('endsAt', value);
  const setReason = (value: string): void => setField('reason', value);
  const setOpen = (value: boolean): void => { if (!value) draft.clear(); };
  const requestClose = async (): Promise<void> => {
    if (pending) return;
    if (draft.dirty && !await confirmDiscard({ title: 'Закрыть форму без сохранения?', consequence: 'Введённые данные замещения будут удалены.', confirmLabel: 'Закрыть форму', tone: 'danger' })) return;
    draft.clear();
  };
  const [localPending, setPending] = useState(false);
  const pending = localPending || draft.submitting;
  const [formError, setFormError] = useState<string | null>(null);
  const [users, setUsers] = useState<SearchableSelectOption[]>([]);
  const [principals, setPrincipals] = useState<SearchableSelectOption[]>([]);
  const principalOptions = useRef(new Map<string, SearchableSelectOption>());
  const [objects, setObjects] = useState<SubstitutionObject[]>([]);
  const [objectSearch, setObjectSearch] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<UserSubstitution | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const scope = JSON.stringify([accessRevision, page, reloadKey]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loadedOptionsScope, setLoadedOptionsScope] = useState<string | null>(null);
  const [optionsCanCreate, setOptionsCanCreate] = useState(false);
  const optionsScope = JSON.stringify([scope, principal, objectSearch]);
  const currentOptionsScope = useRef(optionsScope);
  currentOptionsScope.current = optionsScope;
  const accessCurrent = loadedScope === scope && !loading && !error;
  const canCreateOwn = accessCurrent && list?.capabilities?.canCreate === true;
  const canCreate = canCreateOwn || (accessCurrent && list?.capabilities?.canCreateForOthers === true);
  const optionsLoaded = loadedOptionsScope === optionsScope && !optionsLoading;
  const optionsCurrent = loadedOptionsScope === optionsScope && !optionsLoading && optionsCanCreate;
  const canSubmit = canCreate && optionsCurrent && !!principal;
  const currentRevokeTarget = accessCurrent ? list?.items.find((item) => item.id === revokeTarget?.id && item.canRevoke) : undefined;
  const actionState = useRef({ scope, canCreate, canSubmit, currentRevokeTarget });
  actionState.current = { scope, canCreate, canSubmit, currentRevokeTarget };

  useEffect(() => { userOptions.current.clear(); principalOptions.current.clear(); }, [accessRevision]);

  useEffect(() => {
    if (savedWithoutAccess) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listUserSubstitutions(page).then((response) => { if (!cancelled && currentScope.current === scope) { setList(response); setLoadedScope(scope); } })
      .catch((caught: unknown) => { if (!cancelled && currentScope.current === scope) setError(message(caught)); })
      .finally(() => { if (!cancelled && currentScope.current === scope) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, reloadKey, scope, savedWithoutAccess]);

  useEffect(() => {
    if (!open || !canCreate) { setLoadedOptionsScope(null); setOptionsLoading(false); return; }
    let cancelled = false;
    setLoadedOptionsScope(null);
    setOptionsLoading(true);
    const timeout = window.setTimeout(() => {
      void getSubstitutionOptions({ principalUserId: principal || undefined, objectSearch }).then((response) => {
        if (!cancelled && currentOptionsScope.current === optionsScope) {
          setObjects(response.objects);
          const options = response.users.map((user) => ({ value: user.id, label: user.fullName, description: `@${user.login}` }));
          for (const option of options) userOptions.current.set(option.value, option);
          setUsers(options);
          const targets = response.principals.map((entry) => ({ value: entry.id, label: entry.fullName, description: `@${entry.login}` }));
          if (canCreateOwn && user) targets.unshift({ value: user.id, label: user.fullName, description: 'Мой собственный доступ' });
          for (const target of targets) principalOptions.current.set(target.value, target);
          setPrincipals(targets);
          setOptionsCanCreate(response.capabilities?.canCreate === true);
          setLoadedOptionsScope(optionsScope);
        }
      }).catch((caught: unknown) => { if (!cancelled && currentOptionsScope.current === optionsScope) setFormError(message(caught)); })
        .finally(() => { if (!cancelled && currentOptionsScope.current === optionsScope) setOptionsLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [open, principal, objectSearch, canCreate, canCreateOwn, user, optionsScope]);

  const changePrincipal = (value: string): void => {
    if (!actionState.current.canCreate || currentScope.current !== scope || currentOptionsScope.current !== optionsScope || value === principal) return;
    const target = principalOptions.current.get(value);
    if (!target || !optionsLoaded) return;
    draft.setValue(current => ({ ...current, principal: value, principalOption: target,
      replacement: '', replacementOption: null, selected: [] }));
    setObjectSearch(''); setFormError(null); userOptions.current.clear();
  };

  const start = (): void => {
    if (!actionState.current.canCreate || actionState.current.scope !== scope) return;
    const starts = moscowDateTime(new Date());
    const ends = moscowDateTime(new Date(Date.now() + 7 * 86_400_000));
    draft.setValue({ open: true, principal: canCreateOwn && user ? user.id : '',
      principalOption: canCreateOwn && user ? { value: user.id, label: user.fullName } : null,
      replacement: '', selected: [], startNow: true, startsAt: starts, endsAt: ends, reason: '', initialStartsAt: starts, initialEndsAt: ends, replacementOption: null });
    draft.setDirty(false);
    submitLock.current = false;
    setObjectSearch(''); setFormError(null);
  };
  const closeSavedWithoutAccess = (): void => {
    draft.clear(); setRevokeTarget(null); setRevokeReason(''); setList(null);
    setLoadedScope(null); setLoadedOptionsScope(null); setFormError(null);
    setError(null); setSavedWithoutAccess(true); submitLock.current = false;
  };
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || submitLock.current || !actionState.current.canSubmit || actionState.current.scope !== scope || currentOptionsScope.current !== optionsScope) return;
    setFormError(null);
    const from = startNow ? new Date() : new Date(`${startsAt}:00+03:00`);
    const to = new Date(`${endsAt}:00+03:00`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || (!startNow && from.getTime() < Date.now())) {
      setFormError('Укажите будущий период: окончание должно быть позже начала.'); return;
    }
    submitLock.current = true;
    setPending(true);
    try {
      const result = await draft.submit(() => createUserSubstitution({ principalUserId: principal, replacementUserId: replacement, objectIds: selected.map((item) => item.id), startsAt: from.toISOString(), endsAt: to.toISOString(), reason: reason.trim() }));
      if (isSavedWithoutAccess(result)) { closeSavedWithoutAccess(); return; }
      if (currentScope.current !== scope) { submitLock.current = false; return; }
      setOpen(false); setPage(1); setReloadKey((value) => value + 1);
    } catch (caught) { submitLock.current = false; if (currentScope.current === scope) setFormError(message(caught)); }
    finally { setPending(false); }
  };
  const revoke = async (value: string): Promise<void> => {
    const target = actionState.current.currentRevokeTarget;
    if (!target || target.id !== revokeTarget?.id || pending || actionState.current.scope !== scope) return;
    setPending(true); setFormError(null);
    try { const result = await revokeUserSubstitution(target.id, value); if (isSavedWithoutAccess(result)) { closeSavedWithoutAccess(); return; } if (currentScope.current !== scope) return; setRevokeTarget(null); setReloadKey((key) => key + 1); }
    catch (caught) { if (currentScope.current === scope) setFormError(message(caught)); }
    finally { setPending(false); }
  };

  if (savedWithoutAccess) return <div className={styles.page}>
    <PageHeader title="Замещения" />
    <Alert tone="success" role="status">Изменение сохранено.</Alert>
    <Button onClick={() => { setSavedWithoutAccess(false); setReloadKey(key => key + 1); }}>Обновить данные</Button>
  </div>;

  return <div className={styles.page}>
    <PageHeader title="Замещения" description="Передайте свой доступ к выбранным объектам на определённый срок. Собственные права заместителя сохраняются." actions={canCreate ? <Button variant="primary" icon={<PlusIcon />} onClick={start}>Создать замещение</Button> : undefined} />
    <Alert>Замещение не выдаёт глобальных прав на деньги, зарплаты, кадровые данные или согласования. Автором действий остаётся заместитель. Время указано по Москве.</Alert>
    {error ? <Alert tone="danger" role="alert" action={<Button onClick={() => setReloadKey((key) => key + 1)}>Повторить</Button>}>{error}</Alert> : null}
    {loading ? <p aria-live="polite">Загрузка замещений…</p> : !error && !list?.items.length ? <p className={styles.muted}>У вас пока нет замещений.</p> : null}
    <div className={styles.records} aria-busy={loading}>
      {accessCurrent && list?.items.map((item) => <article className={styles.card} key={item.id}>
        <div className={styles.cardHeader}><h2>{item.principal.fullName} <span className={styles.muted}>→</span> {item.replacement.fullName}</h2><Badge tone={item.status === 'active' ? 'success' : 'neutral'}>{STATUS_LABELS[item.status]}</Badge></div>
        <p className={styles.muted}>{formatPeriod(item.startsAt)} — {formatPeriod(item.endsAt)} · Москва</p>
        <div className={styles.objectLinks}>{item.objects.map((object) => <Link key={object.id} href={`/objects/${object.id}`}>{object.name}{object.archived ? ' · архив' : ''}</Link>)}</div>
        <p className={styles.reason}>{item.reason}</p>
        <div className={styles.cardFooter}><span className={styles.muted}>Создал: {item.createdBy.fullName}{item.revokedBy ? ` · Прекратил: ${item.revokedBy.fullName}` : ''}</span>{item.canRevoke ? <Button size="sm" onClick={() => { setRevokeTarget(item); setRevokeReason(''); setFormError(null); }}>Прекратить замещение</Button> : null}</div>
        {item.revocationReason ? <p className={styles.muted}>Причина прекращения: {item.revocationReason}</p> : null}
      </article>)}
    </div>
    {accessCurrent && list ? <TablePagination page={page} totalPages={list.totalPages} pending={loading} label="Страницы замещений"
      summary={list.total > 0 ? `Показано ${(page - 1) * 20 + 1}–${Math.min(page * 20, list.total)} из ${list.total}` : 'Замещения не найдены'}
      onPageChange={setPage} /> : null}
    <Dialog open={open} onOpenChange={(value) => { if (!value) void requestClose(); }} busy={pending} title="Создать замещение" description="Собственный доступ выбранного пользователя. Полученные по замещению права передать дальше нельзя." footer={<div className={styles.actions}><Button disabled={pending} onClick={() => void requestClose()}>Отмена</Button><Button variant="primary" type="submit" form="substitution-form" pending={pending} disabled={!canSubmit || !replacement || !selected.length || !reason.trim()}>Создать замещение</Button></div>}>
      <form id="substitution-form" className={styles.form} onSubmit={(event) => { void save(event); }}>
        {formError ? <Alert tone="danger" role="alert" action={<Button disabled={pending} onClick={() => setReloadKey((key) => key + 1)}>Повторить загрузку</Button>}>{formError}</Alert> : null}
        {!canCreate ? <Alert action={<Button disabled={pending || loading} onClick={() => setReloadKey((key) => key + 1)}>Обновить доступ</Button>}>Доступ к созданию обновляется или недоступен. Черновик сохранён.</Alert> : null}
        <SearchableSelect key={`principal:${scope}`} label="Чей доступ передаётся" value={principal} selectedOption={draft.value.principalOption}
          options={optionsLoaded && canCreate ? principals : []} onChange={changePrincipal} required clearable={false}
          disabled={pending || !canCreate || !optionsLoaded} viewportAware placeholder="Выберите пользователя"
          searchPlaceholder="Имя или логин" asyncSearch={async (query) => {
            if (currentScope.current !== scope || !actionState.current.canCreate) return [];
            const response = await getSubstitutionOptions({ principalSearch: query });
            if (currentScope.current !== scope || !actionState.current.canCreate) return [];
            const targets = response.principals.map(entry => ({ value: entry.id, label: entry.fullName, description: `@${entry.login}` }));
            if (canCreateOwn && user) targets.unshift({ value: user.id, label: user.fullName, description: 'Мой собственный доступ' });
            for (const target of targets) principalOptions.current.set(target.value, target);
            return targets;
          }} />
        <SearchableSelect key={optionsScope} label="Кто замещает" value={replacement} selectedOption={draft.value.replacementOption} options={optionsCurrent && canCreate ? users : []} onChange={setReplacement} required disabled={pending || !canSubmit} viewportAware placeholder="Выберите пользователя" searchPlaceholder="Имя или логин" asyncSearch={async (query) => { if (currentOptionsScope.current !== optionsScope || !actionState.current.canSubmit) return []; const response = await getSubstitutionOptions({ principalUserId: principal || undefined, userSearch: query }); if (currentScope.current !== scope || !actionState.current.canSubmit || !response.capabilities?.canCreate) return []; const options = response.users.map((user) => ({ value: user.id, label: user.fullName, description: `@${user.login}` })); for (const option of options) userOptions.current.set(option.value, option); return options; }} />
        <fieldset className={styles.scope}><legend>Объекты · выбрано {selected.length} из 100</legend>
          <Field label="Найти объект"><input type="search" value={objectSearch} maxLength={100} onChange={(event) => setObjectSearch(event.target.value)} placeholder="Название или адрес" disabled={pending} /></Field>
          {selected.length ? <div className={styles.selected}>{selected.map((item) => <Button size="sm" key={item.id} disabled={pending} aria-label={`Убрать ${item.name} из замещения`} onClick={() => setSelected((values) => values.filter((entry) => entry.id !== item.id))}>{item.name} ×</Button>)}</div> : null}
          <div className={styles.objectList} aria-busy={optionsLoading}>{optionsCurrent && canCreate && objects.map((item) => <label key={item.id}><input type="checkbox" checked={selected.some((entry) => entry.id === item.id)} disabled={pending || !canSubmit || (selected.length >= 100 && !selected.some((entry) => entry.id === item.id))} onChange={(event) => setSelected((values) => event.target.checked ? [...values, item] : values.filter((entry) => entry.id !== item.id))} /> <span>{item.name}</span></label>)}{optionsLoading ? <p className={styles.muted}>Поиск…</p> : !objects.length ? <p className={styles.muted}>Нет доступных объектов.</p> : null}</div>
          <p className={styles.muted}>Показаны первые 100 результатов. Уточните поиск; выбранные объекты сохранятся.</p>
        </fieldset>
        <label className={styles.check}><input type="checkbox" checked={startNow} onChange={(event) => setStartNow(event.target.checked)} disabled={pending} /> Начать сразу после сохранения</label>
        <div className={styles.dates}>{!startNow ? <Field label="Начало · Москва" required><DatePicker displayFormat="short" required withTime value={startsAt} onChange={(nextValue) => setStartsAt(nextValue)} disabled={pending} /></Field> : null}<Field label="Окончание · Москва" required><DatePicker withTime value={endsAt} onChange={(nextValue) => setEndsAt(nextValue)} disabled={pending} /></Field></div>
        <Field label="Основание" required><textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например, отпуск или временное замещение" disabled={pending} /></Field>
      </form>
    </Dialog>
    {confirmDialog}
    <ReasonDialog open={!!currentRevokeTarget} onOpenChange={(value) => { if (!value) setRevokeTarget(null); }} title="Прекратить замещение?" description="Делегированный доступ закроется со следующего запроса. Собственные права пользователя останутся." reason={revokeReason} onReasonChange={setRevokeReason} onConfirm={(value) => { void revoke(value); }} confirmLabel="Прекратить замещение" pending={pending} error={formError} />
  </div>;
}
