'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';

import { createUserSubstitution, getSubstitutionOptions, listUserSubstitutions, revokeUserSubstitution, type SubstitutionList, type SubstitutionObject, type UserSubstitution } from '@/entities/user-substitution/api/user-substitution-client';
import { Alert, Badge, Button, Field, PageHeader } from '@/shared/ui/foundation';
import { Dialog, ReasonDialog } from '@/shared/ui/overlays';
import { SearchableSelect, type SearchableSelectOption } from '@/shared/ui/searchable-select/searchable-select';
import { TablePagination } from '@/shared/ui/table-pagination/table-pagination';

import styles from './user-substitutions.module.css';

const STATUS_LABELS = { active: 'Действует', scheduled: 'Запланировано', expired: 'Завершено', revoked: 'Прекращено' };
function moscowDateTime(value: Date): string {
  return new Date(value.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
function formatPeriod(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function message(error: unknown): string { return error instanceof Error ? error.message : 'Не удалось выполнить действие.'; }

export default function UserSubstitutionsPage(): React.JSX.Element {
  const [list, setList] = useState<SubstitutionList | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('');
  const [users, setUsers] = useState<SearchableSelectOption[]>([]);
  const [objects, setObjects] = useState<SubstitutionObject[]>([]);
  const [selected, setSelected] = useState<SubstitutionObject[]>([]);
  const [objectSearch, setObjectSearch] = useState('');
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [startNow, setStartNow] = useState(true);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<UserSubstitution | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listUserSubstitutions(page).then((response) => { if (!cancelled) setList(response); })
      .catch((caught: unknown) => { if (!cancelled) setError(message(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, reloadKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOptionsLoading(true);
    const timeout = window.setTimeout(() => {
      void getSubstitutionOptions({ objectSearch }).then((response) => {
        if (!cancelled) {
          setObjects(response.objects);
          setUsers(response.users.map((user) => ({ value: user.id, label: user.fullName, description: `@${user.login}` })));
        }
      }).catch((caught: unknown) => { if (!cancelled) setFormError(message(caught)); })
        .finally(() => { if (!cancelled) setOptionsLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [open, objectSearch]);

  const start = (): void => {
    setReplacement(''); setSelected([]); setObjectSearch(''); setReason(''); setFormError(null);
    setStartNow(true); setStartsAt(moscowDateTime(new Date()));
    setEndsAt(moscowDateTime(new Date(Date.now() + 7 * 86_400_000))); setOpen(true);
  };
  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setFormError(null);
    const from = startNow ? new Date() : new Date(`${startsAt}:00+03:00`);
    const to = new Date(`${endsAt}:00+03:00`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || (!startNow && from.getTime() < Date.now())) {
      setFormError('Укажите будущий период: окончание должно быть позже начала.'); return;
    }
    setPending(true);
    try {
      await createUserSubstitution({ replacementUserId: replacement, objectIds: selected.map((item) => item.id), startsAt: from.toISOString(), endsAt: to.toISOString(), reason: reason.trim() });
      setOpen(false); setPage(1); setReloadKey((value) => value + 1);
    } catch (caught) { setFormError(message(caught)); }
    finally { setPending(false); }
  };
  const revoke = async (value: string): Promise<void> => {
    if (!revokeTarget || pending) return;
    setPending(true); setFormError(null);
    try { await revokeUserSubstitution(revokeTarget.id, value); setRevokeTarget(null); setReloadKey((key) => key + 1); }
    catch (caught) { setFormError(message(caught)); }
    finally { setPending(false); }
  };

  return <div className={styles.page}>
    <PageHeader title="Замещения" description="Передайте свой доступ к выбранным объектам на определённый срок. Собственные права заместителя сохраняются." actions={<Button variant="primary" onClick={start}>Создать замещение</Button>} />
    <Alert>Замещение не выдаёт глобальных прав на деньги, зарплаты, кадровые данные или согласования. Автором действий остаётся заместитель. Время указано по Москве.</Alert>
    {error ? <Alert tone="danger" role="alert" action={<Button onClick={() => setReloadKey((key) => key + 1)}>Повторить</Button>}>{error}</Alert> : null}
    {loading ? <p aria-live="polite">Загрузка замещений…</p> : !error && !list?.items.length ? <p className={styles.muted}>У вас пока нет замещений.</p> : null}
    <div className={styles.records} aria-busy={loading}>
      {list?.items.map((item) => <article className={styles.card} key={item.id}>
        <div className={styles.cardHeader}><h2>{item.principal.fullName} <span className={styles.muted}>→</span> {item.replacement.fullName}</h2><Badge tone={item.status === 'active' ? 'success' : 'neutral'}>{STATUS_LABELS[item.status]}</Badge></div>
        <p className={styles.muted}>{formatPeriod(item.startsAt)} — {formatPeriod(item.endsAt)} · Москва</p>
        <div className={styles.objectLinks}>{item.objects.map((object) => <Link key={object.id} href={`/objects/${object.id}`}>{object.name}{object.archived ? ' · архив' : ''}</Link>)}</div>
        <p className={styles.reason}>{item.reason}</p>
        <div className={styles.cardFooter}><span className={styles.muted}>Создал: {item.createdBy.fullName}{item.revokedBy ? ` · Прекратил: ${item.revokedBy.fullName}` : ''}</span>{item.canRevoke ? <Button size="sm" onClick={() => { setRevokeTarget(item); setRevokeReason(''); setFormError(null); }}>Прекратить замещение</Button> : null}</div>
        {item.revocationReason ? <p className={styles.muted}>Причина прекращения: {item.revocationReason}</p> : null}
      </article>)}
    </div>
    {list ? <TablePagination page={page} totalPages={list.totalPages} pending={loading} label="Страницы замещений"
      summary={list.total > 0 ? `Показано ${(page - 1) * 20 + 1}–${Math.min(page * 20, list.total)} из ${list.total}` : 'Замещения не найдены'}
      onPageChange={setPage} /> : null}
    <Dialog open={open} onOpenChange={setOpen} busy={pending} title="Создать замещение" description="Только ваш собственный доступ. Полученные по замещению права передать дальше нельзя." footer={<div className={styles.actions}><Button disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button variant="primary" type="submit" form="substitution-form" pending={pending} disabled={!replacement || !selected.length || !reason.trim() || optionsLoading}>Создать замещение</Button></div>}>
      <form id="substitution-form" className={styles.form} onSubmit={(event) => { void save(event); }}>
        {formError ? <Alert tone="danger" role="alert">{formError}</Alert> : null}
        <SearchableSelect label="Кто замещает" value={replacement} options={users} onChange={setReplacement} required disabled={pending} viewportAware placeholder="Выберите пользователя" searchPlaceholder="Имя или логин" asyncSearch={async (query) => (await getSubstitutionOptions({ userSearch: query })).users.map((user) => ({ value: user.id, label: user.fullName, description: `@${user.login}` }))} />
        <fieldset className={styles.scope}><legend>Объекты · выбрано {selected.length} из 100</legend>
          <Field label="Найти объект"><input type="search" value={objectSearch} maxLength={100} onChange={(event) => setObjectSearch(event.target.value)} placeholder="Название или адрес" disabled={pending} /></Field>
          {selected.length ? <div className={styles.selected}>{selected.map((item) => <Button size="sm" key={item.id} disabled={pending} aria-label={`Убрать ${item.name} из замещения`} onClick={() => setSelected((values) => values.filter((entry) => entry.id !== item.id))}>{item.name} ×</Button>)}</div> : null}
          <div className={styles.objectList} aria-busy={optionsLoading}>{objects.map((item) => <label key={item.id}><input type="checkbox" checked={selected.some((entry) => entry.id === item.id)} disabled={pending || (selected.length >= 100 && !selected.some((entry) => entry.id === item.id))} onChange={(event) => setSelected((values) => event.target.checked ? [...values, item] : values.filter((entry) => entry.id !== item.id))} /> <span>{item.name}</span></label>)}{optionsLoading ? <p className={styles.muted}>Поиск…</p> : !objects.length ? <p className={styles.muted}>Нет доступных объектов.</p> : null}</div>
          <p className={styles.muted}>Показаны первые 100 результатов. Уточните поиск; выбранные объекты сохранятся.</p>
        </fieldset>
        <label className={styles.check}><input type="checkbox" checked={startNow} onChange={(event) => setStartNow(event.target.checked)} disabled={pending} /> Начать сразу после сохранения</label>
        <div className={styles.dates}>{!startNow ? <Field label="Начало · Москва" required><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={pending} /></Field> : null}<Field label="Окончание · Москва" required><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={pending} /></Field></div>
        <Field label="Основание" required><textarea rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например, отпуск или временное замещение" disabled={pending} /></Field>
      </form>
    </Dialog>
    <ReasonDialog open={!!revokeTarget} onOpenChange={(value) => { if (!value) setRevokeTarget(null); }} title="Прекратить замещение?" description="Делегированный доступ закроется со следующего запроса. Собственные права пользователя останутся." reason={revokeReason} onReasonChange={setRevokeReason} onConfirm={(value) => { void revoke(value); }} confirmLabel="Прекратить замещение" pending={pending} error={formError} />
  </div>;
}
