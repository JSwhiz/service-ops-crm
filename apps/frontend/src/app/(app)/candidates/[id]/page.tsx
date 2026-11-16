'use client';

import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useAccessRevision } from '@/shared/auth/use-access-revision';
import { useAuth } from '@/shared/auth/use-auth';
import { useOpenAccessRefresh } from '@/shared/auth/use-open-access-refresh';
import { ApiError } from '@/shared/api/fetcher';
import { getAccessGeneration, isAccessGenerationCurrent } from '@/shared/auth/access-generation';
import { AccessSnapshotBoundary } from '@/shared/auth/access-snapshot-boundary';

import {
  addCandidateResponse,
  assignCandidateManagers,
  convertCandidateToEmployee,
  changeCandidateStatus,
  getCandidate,
  setCandidateArchive,
  updateCandidate,
} from '@/entities/candidate/api/candidate-client';
import {
  CANDIDATE_STATUS_OPTIONS,
  CANDIDATE_TYPE_OPTIONS,
  CANDIDATE_EMPLOYEE_TYPE_OPTIONS,
  candidateActiveAssignments,
  candidateAssignmentSla,
  candidatePhones,
  candidateSlaLabel,
  candidateStatusLabel,
  candidateTypeLabel,
} from '@/entities/candidate/lib/candidate-presentation';
import type {
  CandidateCard,
  CandidateEmployeeType,
  CandidateSlaState,
  CandidateStatus,
  CandidateType,
} from '@/entities/candidate/model/candidate.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { formatPhone, getPhoneHref } from '@/shared/lib/phone';
import { Alert, BackLink, Badge, Button, ButtonLink, EmptyState, EntityHeader, FactStrip, Field, IconButton, Skeleton, Surface, type BadgeProps } from '@/shared/ui/foundation';
import { OverflowMenu, type OverflowMenuItem } from '@/shared/ui/overflow-menu/overflow-menu';
import { SelectField } from '@/shared/ui/searchable-select/select-field';
import { ConfirmDialog, Dialog } from '@/shared/ui/overlays';
import {
  CandidateManagerFields,
  candidateManagerDrafts,
  candidateManagerPayload,
  candidateManagersValid,
  type CandidateManagerDraft,
} from '@/features/candidate-registry/ui/candidate-fields';
import {
  PhoneListField,
  phoneDrafts,
  phoneDraftValues,
  phoneDraftsValid,
} from '@/shared/ui/phone-list-field/phone-list-field';
import styles from '@/features/candidate-registry/ui/candidate-fields.module.css';
import card from '@/features/candidate-registry/ui/candidate-card.module.css';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';
import { PencilIcon } from '@/shared/ui/icons/icons';
import { UserAvatar } from '@/shared/ui/user-avatar/user-avatar';

function toObjectOption(object: ServiceObject): SearchableSelectOption {
  return {
    value: object.id,
    label: object.name,
    description: [object.internalName, object.address]
      .filter(Boolean)
      .join(' · '),
    searchText: [object.name, object.internalName, object.address]
      .filter(Boolean)
      .join(' '),
  };
}

function candidateObjectOption(
  candidate: CandidateCard,
): SearchableSelectOption | null {
  return candidate.object
    ? {
        value: candidate.object.id,
        label: candidate.object.name,
        description: [candidate.object.internalName, candidate.object.address]
          .filter(Boolean)
          .join(' · '),
      }
    : null;
}

const CLOSED_STATUSES: CandidateStatus[] = ['accepted', 'rejected'];

const STATUS_TONE: Record<CandidateStatus, NonNullable<BadgeProps['tone']>> = {
  new: 'info',
  in_progress: 'accent',
  accepted: 'success',
  rejected: 'neutral',
};

const SLA_TONE: Record<CandidateSlaState, NonNullable<BadgeProps['tone']>> = {
  unassigned: 'neutral',
  awaiting_response: 'warning',
  overdue: 'danger',
  responded: 'success',
};

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value)).replace(' г.', '');
}

function latestManagerDrafts(candidate: CandidateCard): CandidateManagerDraft[] {
  const ended = candidate.assignments
    .filter((assignment) => assignment.endedAt)
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  const lastEndedAt = ended[0]?.endedAt;
  if (!lastEndedAt) return [];
  const lastBatch = ended.filter(
    (assignment) =>
      Math.abs(
        new Date(assignment.endedAt ?? 0).getTime() -
          new Date(lastEndedAt).getTime(),
      ) < 60_000,
  );
  const seen = new Set<string>();
  return candidateManagerDrafts(
    lastBatch.filter((assignment) => {
      if (seen.has(assignment.manager.id)) return false;
      seen.add(assignment.manager.id);
      return true;
    }),
  );
}

export default function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const accessRevision = useAccessRevision();
  const { user, capabilitiesRefreshError } = useAuth();
  const [loadedAccessRevision, setLoadedAccessRevision] = useState<string | null>(null);
  const [loadedParams, setLoadedParams] = useState<typeof params | null>(null);
  const [accessRetry, setAccessRetry] = useState(0);
  const [candidate, setCandidate] = useState<CandidateCard | null>(null);
  const router = useRouter();
  const [managers, setManagers] = useState<CandidateManagerDraft[]>([]);
  const [editingManagers, setEditingManagers] = useState(false);
  const [converting, setConverting] = useState(false);
  const [employeeType, setEmployeeType] =
    useState<CandidateEmployeeType>('regular');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<CandidateStatus | null>(
    null,
  );
  const [reopenManagers, setReopenManagers] = useState<
    CandidateManagerDraft[]
  >([]);
  const [, setClock] = useState(0);
  const [responseText, setResponseText] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phones: phoneDrafts(['']),
    comment: '',
    candidateType: 'regular' as CandidateType,
    objectId: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editingRef = React.useRef(editing);
  editingRef.current = editing;
  const activeCandidateId = React.useRef<string | null>(null);
  const snapshotReady = !capabilitiesRefreshError && loadedAccessRevision === accessRevision && loadedParams === params;
  useOpenAccessRefresh(candidate !== null);
  const candidateContext = React.useRef({ candidate, params, accessRevision, ready: snapshotReady });
  candidateContext.current = { candidate, params, accessRevision, ready: snapshotReady };
  const [candidateIntent, setCandidateIntent] = useState<{
    kind: 'status' | 'archive' | 'convert'; isCurrent: () => boolean;
  } | null>(null);
  const candidateIntentRef = React.useRef(candidateIntent);
  candidateIntentRef.current = candidateIntent;
  const statusDraftOwner = React.useRef<{ actorId: string | undefined; candidateId: string; params: typeof params } | null>(null);
  const previousLifecycleAccess = React.useRef<{ key: string; revision: string; caps: CandidateCard['capabilities'] } | null>(null);
  const [revokedActions, setRevokedActions] = useState<{ key: string; leaves: string[] } | null>(null);
  const mutationSequence = React.useRef(0);
  const captureCandidateAction = (leaf: keyof CandidateCard['capabilities']): (() => boolean) => {
    const generation = getAccessGeneration();
    const origin = { candidate, params, accessRevision };
    return () => isAccessGenerationCurrent(generation) && candidateContext.current.ready &&
      candidateContext.current.params === origin.params && candidateContext.current.accessRevision === origin.accessRevision &&
      origin.candidate !== null && candidateContext.current.candidate === origin.candidate && candidateContext.current.candidate?.id === origin.candidate.id &&
      candidateContext.current.candidate?.version === origin.candidate.version &&
      (leaf === 'canChangeStatus'
        ? (candidateContext.current.candidate?.capabilities.canChangeStatus ?? candidateContext.current.candidate?.capabilities.canManage) === true
        : leaf === 'canManageAssignments'
          ? (candidateContext.current.candidate?.capabilities.canManageAssignments ?? candidateContext.current.candidate?.capabilities.canManage) === true
          : candidateContext.current.candidate?.capabilities[leaf] === true);
  };
  const cancelCandidateIntent = (): void => {
    statusDraftOwner.current = null;
    candidateIntentRef.current = null;
    setCandidateIntent(null); setArchiveOpen(false); setStatusTarget(null); setConverting(false);
  };
  const isIntentCurrent = (kind: 'status' | 'archive' | 'convert'): boolean => candidateIntentRef.current === candidateIntent && candidateIntent?.kind === kind && candidateIntent.isCurrent();
  useEffect(() => {
    if (candidateIntent && !candidateIntent.isCurrent()) {
      // Invalidate the authorization token, retaining only the private status draft.
      candidateIntentRef.current = null;
      setCandidateIntent(null); setArchiveOpen(false); setConverting(false);
    }
  }, [candidateIntent, snapshotReady, candidate, params, accessRevision]);
  useEffect(() => {
    const owner = statusDraftOwner.current;
    if (owner && (owner.actorId !== user?.id || owner.params !== params || owner.candidateId !== candidate?.id)) {
      statusDraftOwner.current = null; setStatusTarget(null); setReopenManagers([]);
      return;
    }
    if (!snapshotReady || !candidate || !statusTarget || !owner || candidateIntent) return;
    if (candidate.status === statusTarget) { statusDraftOwner.current = null; setStatusTarget(null); return; }
    if ((candidate.capabilities.canChangeStatus ?? candidate.capabilities.canManage) === true) {
      // A fresh confirmation uses the new version and generation; never send a write here.
      setCandidateIntent({ kind: 'status', isCurrent: captureCandidateAction('canChangeStatus') });
    }
  }, [snapshotReady, candidate, candidateIntent, statusTarget, user?.id, params, accessRevision]);
  useEffect(() => {
    if (!snapshotReady || !candidate) return;
    const key = JSON.stringify([user?.id, candidate.id]);
    const previous = previousLifecycleAccess.current;
    const leaves = ['canChangeStatus', 'canArchive', 'canRestore', 'canConvert'] as const;
    if (previous?.key === key && previous.revision !== accessRevision) {
      const lost = leaves.filter(leaf => previous.caps[leaf] === true && candidate.capabilities[leaf] === false);
      setRevokedActions(current => ({ key, leaves: [...new Set([...(current?.key === key ? current.leaves : []), ...lost])].filter(leaf => candidate.capabilities[leaf as typeof leaves[number]] === false) }));
    }
    previousLifecycleAccess.current = { key, revision: accessRevision, caps: candidate.capabilities };
  }, [snapshotReady, candidate, user?.id, accessRevision]);
  useEffect(() => () => { candidateContext.current = { ...candidateContext.current, ready: false }; }, []);

  const syncForm = (item: CandidateCard): void => {
    setForm({
      fullName: item.fullName,
      phones: phoneDrafts(candidatePhones(item)),
      comment: item.comment ?? '',
      candidateType: item.candidateType,
      objectId: item.object?.id ?? '',
    });
  };

  useEffect(() => {
    const timer = window.setInterval(
      () => setClock((value) => value + 1),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoadedAccessRevision(null);
    if (capabilitiesRefreshError) return;
    setError(null);
    void params
      .then(({ id }) => {
        if (!active) return null;
        if (activeCandidateId.current !== id) {
          activeCandidateId.current = id;
          editingRef.current = false;
          mutationSequence.current += 1;
          setSaving(false);
          setEditing(false); setEditingManagers(false); setResponseText(''); setManagers([]); setReopenManagers([]);
          setEmployeeType('regular'); setConversionError(null);
        }
        return getCandidate(id);
      })
      .then((item) => {
        if (active && item) {
          setCandidate(item);
          setLoadedAccessRevision(accessRevision);
          setLoadedParams(params);
          if (!editingRef.current) syncForm(item);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setError(error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)
          ? 'Карточка кандидата недоступна.'
          : 'Не удалось загрузить кандидата.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params, accessRevision, accessRetry, capabilitiesRefreshError]);

  const apply = (next: CandidateCard): void => {
    setCandidate(next);
    syncForm(next);
  };

  const mutate = async (
    operation: () => Promise<CandidateCard>,
    isCurrent: () => boolean,
  ): Promise<boolean> => {
    const generation = getAccessGeneration();
    const isCurrentMutation = (): boolean => isCurrent() && isAccessGenerationCurrent(generation) && candidateContext.current.ready &&
      candidateContext.current.params === params && candidateContext.current.accessRevision === accessRevision &&
      candidateContext.current.candidate === candidate && candidate !== null;
    if (saving || !isCurrentMutation()) return false;
    const sequence = ++mutationSequence.current;
    setSaving(true);
    setError(null);
    try {
      const next = await operation();
      if (!isCurrentMutation()) return false;
      apply(next);
      return true;
    } catch (caughtError) {
      if (!isCurrentMutation()) return false;
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Не удалось сохранить изменение. Обновите карточку и повторите.',
      );
      return false;
    } finally {
      if (sequence === mutationSequence.current) setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={card.page} aria-busy="true">
        <Skeleton width={120} height={14} />
        <Skeleton width={360} height={32} />
        <Skeleton height={76} />
        <Skeleton height={320} />
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className={card.page}>
        <BackLink href="/candidates">Кандидаты</BackLink>
        <EmptyState
          title="Кандидат не найден"
          description={error ?? 'Карточка удалена или недоступна.'}
        />
      </div>
    );
  }

  const activeAssignments = candidateActiveAssignments(candidate);
  const canEditManagers =
    (candidate.capabilities.canManageAssignments ?? candidate.capabilities.canManage) &&
    !candidate.deletedAt &&
    !['accepted', 'rejected'].includes(candidate.status);
  const isClosed = CLOSED_STATUSES.includes(candidate.status);
  const reopening = Boolean(
    statusTarget && isClosed && !CLOSED_STATUSES.includes(statusTarget),
  );
  const reopenNeedsManagers = reopening && candidate.candidateType === 'regular';
  const phones = candidatePhones(candidate);
  const requestStatusChange = (next: CandidateStatus): void => {
    const isCurrent = captureCandidateAction('canChangeStatus');
    if (!isCurrent()) return;
    if (next === candidate.status) return;
    const closing = CLOSED_STATUSES.includes(next);
    const opening = isClosed && !closing;
    if (closing || (opening && candidate.candidateType === 'regular')) {
      setError(null);
      setReopenManagers(opening ? latestManagerDrafts(candidate) : []);
      statusDraftOwner.current = { actorId: user?.id, candidateId: candidate.id, params };
      setStatusTarget(next);
      setCandidateIntent({ kind: 'status', isCurrent });
      return;
    }
    void mutate(() => changeCandidateStatus(candidate.id, next, candidate.version), isCurrent);
  };
  const confirmStatusChange = (): void => {
    const isCurrent = (): boolean => candidateIntentRef.current === candidateIntent && candidateIntent?.isCurrent() === true;
    if (!statusTarget || !isIntentCurrent('status') || !isCurrent()) return;
    const target = statusTarget;
    void mutate(() =>
      changeCandidateStatus(
        candidate.id,
        target,
        candidate.version,
        reopenNeedsManagers
          ? candidateManagerPayload(reopenManagers, candidate.object?.id ?? null)
          : undefined,
      ), isCurrent,
    ).then((success) => {
      if (success) { statusDraftOwner.current = null; setStatusTarget(null); }
    });
  };
  const regularObjectMissing =
    form.candidateType === 'regular' && !form.objectId;
  const regularManagerMissing =
    form.candidateType === 'regular' &&
    !isClosed &&
    activeAssignments.length === 0;

  const statusBadge = (
    <Badge tone={STATUS_TONE[candidate.status]}>
      {candidateStatusLabel(candidate.status)}
    </Badge>
  );
  const overflowItems: OverflowMenuItem[] = [
    ...(candidate.capabilities.canRestore
      ? [{
          key: 'restore',
          label: 'Восстановить из архива',
          onSelect: () =>
            void mutate(() => setCandidateArchive(candidate.id, candidate.version, true), captureCandidateAction('canRestore')),
        }]
      : []),
    ...(candidate.capabilities.canArchive
      ? [{
          key: 'archive',
          label: 'Архивировать',
          tone: 'danger' as const,
          onSelect: () => {
            const isCurrent = captureCandidateAction('canArchive');
            if (!isCurrent()) return;
            setCandidateIntent({ kind: 'archive', isCurrent }); setArchiveOpen(true);
          },
        }]
      : []),
  ];

  return (
    <div className={card.page}>
      <BackLink href="/candidates">Кандидаты</BackLink>
      {!snapshotReady ? <div role="status">{capabilitiesRefreshError || error || 'Проверяем доступ к кандидату…'}{error ? <Button onClick={() => setAccessRetry((value) => value + 1)}>Повторить проверку доступа</Button> : null}</div> : null}
      <AccessSnapshotBoundary blocked={!snapshotReady}>

      <EntityHeader
        className={card.header}
        title={
          <span className={card.identity}>
            <UserAvatar fullName={candidate.fullName} size="large" variant="soft" decorative />
            <span>{candidate.fullName}</span>
          </span>
        }
        status={
          <span className={card.badges}>
            {statusBadge}
            {candidate.deletedAt ? <Badge>В архиве</Badge> : null}
          </span>
        }
        metadata={
          <span className={card.metaLine}>
            <span>{candidateTypeLabel(candidate.candidateType)}</span>
            <span>{candidate.object?.name ?? 'Объект не указан'}</span>
          </span>
        }
        actions={
          <>
            {candidate.employeeId ? (
              candidate.capabilities.canViewEmployee ? (
                <ButtonLink href={`/employees/${candidate.employeeId}`}>
                  Открыть сотрудника
                </ButtonLink>
              ) : (
                <Badge tone="success">Сотрудник оформлен</Badge>
              )
            ) : candidate.capabilities.canConvert ? (
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => {
                  const isCurrent = captureCandidateAction('canConvert');
                  if (!isCurrent()) return;
                  setCandidateIntent({ kind: 'convert', isCurrent });
                  setConversionError(null);
                  setConverting(true);
                }}
              >
                Оформить сотрудником
              </Button>
            ) : null}
            {candidate.capabilities.canManage && !editing ? (
              <IconButton
                aria-label="Редактировать данные кандидата"
                title="Редактировать данные кандидата"
                bordered
                disabled={saving}
                onClick={() => {
                  syncForm(candidate);
                  setEditing(true);
                }}
              >
                <PencilIcon size={18} />
              </IconButton>
            ) : null}
            <OverflowMenu items={overflowItems} />
          </>
        }
      />

      {candidate.deletedAt ? (
        <Alert tone="warning">
          Кандидат в архиве: карточка доступна для просмотра, изменения недоступны.
        </Alert>
      ) : null}
      {revokedActions?.key === JSON.stringify([user?.id, candidate.id]) ? revokedActions.leaves.map(leaf => (
        <Alert key={leaf} tone="warning" role="status">{leaf === 'canChangeStatus'
          ? 'Изменение статуса недоступно. Выбранный статус сохранён до восстановления доступа.'
          : leaf === 'canArchive' ? 'Архивирование недоступно: нет прав на действие.'
            : leaf === 'canRestore' ? 'Восстановление из архива недоступно: нет прав на действие.'
              : 'Оформление сотрудником недоступно: нет прав на действие.'}</Alert>
      )) : null}
      {error && !statusTarget && !archiveOpen ? (
        <Alert tone="danger" role="alert">{error}</Alert>
      ) : null}

      <FactStrip
        items={[
          {
            key: 'phones',
            label: phones.length > 1 ? 'Телефоны' : 'Телефон',
            value: (
              <>
                {phones.length ? (
              <span className={card.phoneList}>
                {phones.map((phone) => {
                  const href = getPhoneHref(phone);
                  return href ? (
                    <a key={phone} href={href}>{formatPhone(phone)}</a>
                  ) : (
                    <span key={phone}>{phone}</span>
                  );
                })}
              </span>
            ) : (
              <span className={card.muted}>Не указан</span>
            )}
              </>
            ),
          },
          {
            key: 'status',
            label: 'Статус',
            value: (
              <>
                {(candidate.capabilities.canChangeStatus ?? candidate.capabilities.canManage) && !candidate.deletedAt ? (
              <SearchableSelect
                label="Статус кандидата"
                hideLabel
                value={candidate.status}
                options={CANDIDATE_STATUS_OPTIONS}
                clearable={false}
                searchable={false}
                disabled={saving}
                onChange={(value) => requestStatusChange(value as CandidateStatus)}
              />
            ) : (
              statusBadge
            )}
              </>
            ),
          },
          {
            key: 'sla',
            label: 'Срок обратной связи',
            value: (
              <>
                <Badge tone={SLA_TONE[candidate.slaState]}>
              {candidateSlaLabel(candidate.slaState)}
            </Badge>
              </>
            ),
          },
          {
            key: 'object',
            label: 'Объект',
            value: (
              <>
                {candidate.object ? (
              <>
                {candidate.object.name}
                {candidate.object.address ? (
                  <span className={card.subtle}>{candidate.object.address}</span>
                ) : null}
              </>
            ) : (
              <span className={card.muted}>Не указан</span>
            )}
              </>
            ),
          },
        ]}
      />

      <div className={card.columns}>
        <div className={card.column}>
          <Surface className={card.section}>
            <div className={card.sectionHeader}>
              <h2 className={card.sectionTitle}>
                {editing ? 'Редактирование кандидата' : 'Комментарий'}
              </h2>
            </div>
            {editing ? (
              <>
              {!candidate.capabilities.canManage ? (
                <Alert tone="warning" role="status">Редактирование кандидата недоступно. Черновик сохранён до восстановления доступа.</Alert>
              ) : null}
              <AccessSnapshotBoundary blocked={!candidate.capabilities.canManage}>
              <form
                className={styles.form}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    form.fullName.trim().length < 2 ||
                    regularObjectMissing ||
                    regularManagerMissing ||
                    !phoneDraftsValid(form.phones, true)
                  )
                    return;
                  void mutate(() =>
                    updateCandidate(candidate.id, {
                      expectedVersion: candidate.version,
                      fullName: form.fullName.trim(),
                      phone: phoneDraftValues(form.phones)[0] ?? null,
                      phones: phoneDraftValues(form.phones),
                      comment: form.comment.trim() || null,
                      candidateType: form.candidateType,
                      objectId: form.objectId || null,
                    }), captureCandidateAction('canManage'),
                  ).then((success) => {
                    if (success) setEditing(false);
                  });
                }}
              >
                <Field
                  className={`${styles.field} ${styles.full}`}
                  label="ФИО"
                  required
                  error={form.fullName.trim().length < 2 ? 'Укажите ФИО.' : undefined}
                >
                  <input
                    maxLength={200}
                    value={form.fullName}
                    disabled={saving}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, fullName: event.target.value }))
                    }
                  />
                </Field>
                <div className={styles.full}>
                  <PhoneListField
                    required
                    phones={form.phones}
                    disabled={saving}
                    onChange={(nextPhones) =>
                      setForm((value) => ({ ...value, phones: nextPhones }))
                    }
                  />
                </div>
                <SelectField
                  label="Тип"
                  required
                  value={form.candidateType}
                  options={CANDIDATE_TYPE_OPTIONS}
                  clearable={false}
                  searchable={false}
                  disabled={saving}
                  onChange={(value) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      candidateType: value as CandidateType,
                    }))
                  }
                />
                <SelectField
                  label="Объект"
                  required={form.candidateType === 'regular'}
                  error={regularObjectMissing ? 'Для обычного кандидата выберите объект.' : undefined}
                  value={form.objectId}
                  selectedOption={candidateObjectOption(candidate)}
                  options={[]}
                  disabled={saving}
                  placeholder="Без привязки"
                  searchPlaceholder="Название, адрес или внутреннее имя"
                  emptyText="Доступные объекты не найдены"
                  asyncSearch={async (query) => {
                    const result = await listObjectsPage({
                      q: query,
                      page: 1,
                      limit: 20,
                      sortBy: 'name',
                      sortDirection: 'asc',
                    });
                    return result.items.map(toObjectOption);
                  }}
                  onChange={(value) =>
                    setForm((currentForm) => ({ ...currentForm, objectId: value }))
                  }
                />
                <Field className={`${styles.field} ${styles.full}`} label="Комментарий">
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={form.comment}
                    disabled={saving}
                    onChange={(event) =>
                      setForm((value) => ({ ...value, comment: event.target.value }))
                    }
                  />
                </Field>
                {regularManagerMissing ? (
                  <p className={`${styles.warning} ${styles.full}`} role="alert">
                    Обычному кандидату нужен ответственный менеджер — назначьте
                    его в блоке «Ответственные менеджеры».
                  </p>
                ) : null}
                <div className={`${styles.actions} ${styles.full}`}>
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      syncForm(candidate);
                      setEditing(false);
                    }}
                  >
                    Отмена
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    pending={saving}
                    pendingLabel="Сохранение…"
                    disabled={regularObjectMissing || regularManagerMissing}
                  >
                    Сохранить
                  </Button>
                </div>
              </form>
              </AccessSnapshotBoundary>
              </>
            ) : candidate.comment ? (
              <p className={card.comment}>{candidate.comment}</p>
            ) : (
              <p className={card.muted}>Комментарий не указан.</p>
            )}
          </Surface>

          <Surface className={card.section}>
            <div className={card.sectionHeader}>
              <h2 className={card.sectionTitle}>Обратная связь</h2>
              {candidate.responses.length ? (
                <span className={card.count}>{candidate.responses.length}</span>
              ) : null}
            </div>
            {candidate.responses.length ? (
              <ol className={card.timeline}>
                {candidate.responses.map((response) => (
                  <li key={response.id} className={card.timelineItem}>
                    <div className={card.timelineHead}>
                      <strong>{response.author.fullName}</strong>
                      <time dateTime={response.createdAt}>{formatDateTime(response.createdAt)}</time>
                    </div>
                    <p>{response.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={card.muted}>Обратной связи пока нет.</p>
            )}

            {candidate.capabilities.canRespond && !candidate.deletedAt ? (
              <form
                className={card.responseForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = responseText.trim();
                  if (!text) return;
                  void mutate(() => addCandidateResponse(candidate.id, text), captureCandidateAction('canRespond')).then(
                    (success) => {
                      if (success) setResponseText('');
                    },
                  );
                }}
              >
                <Field label="Новый ответ">
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={responseText}
                    onChange={(event) => setResponseText(event.target.value)}
                    placeholder="Например: подходит, готов выйти; не дозвонился; перезвонить позже"
                  />
                </Field>
                <div className={card.formActions}>
                  <Button
                    type="submit"
                    variant="primary"
                    pending={saving}
                    disabled={!responseText.trim()}
                  >
                    Отправить ответ
                  </Button>
                </div>
              </form>
            ) : null}
          </Surface>
        </div>

        <div className={card.column}>
          <Surface className={card.section}>
            <div className={card.sectionHeader}>
              <h2 className={card.sectionTitle}>Ответственные менеджеры</h2>
              {canEditManagers && !editingManagers ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setManagers(candidateManagerDrafts(activeAssignments));
                    setEditingManagers(true);
                  }}
                >
                  Изменить
                </Button>
              ) : null}
            </div>
            {editingManagers ? (
              <div className={card.managerEditor}>
                <CandidateManagerFields
                  rows={managers}
                  onChange={setManagers}
                  defaultObject={candidate.object}
                  disabled={saving}
                  requireManager={candidate.candidateType === 'regular'}
                />
                <div className={card.formActions}>
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => setEditingManagers(false)}
                  >
                    Отмена
                  </Button>
                  <Button
                    variant="primary"
                    pending={saving}
                    disabled={
                      !candidateManagersValid(
                        managers,
                        candidate.candidateType === 'regular',
                      )
                    }
                    onClick={() => {
                      void mutate(() =>
                        assignCandidateManagers(
                          candidate.id,
                          candidateManagerPayload(managers, candidate.object?.id ?? null),
                          candidate.version,
                        ), captureCandidateAction('canManageAssignments'),
                      ).then((success) => {
                        if (success) setEditingManagers(false);
                      });
                    }}
                  >
                    Сохранить
                  </Button>
                </div>
              </div>
            ) : activeAssignments.length ? (
              <ul className={card.list}>
                {activeAssignments.map((assignment) => {
                  const sla = candidateAssignmentSla(assignment);
                  return (
                    <li key={assignment.id} className={card.listItem}>
                      <div className={card.listMain}>
                        <strong>{assignment.manager.fullName || assignment.manager.login}</strong>
                        <span className={card.subtle}>
                          {assignment.object?.name ?? 'Без объекта рассмотрения'}
                          {' · назначен '}
                          {formatDateTime(assignment.assignedAt)}
                        </span>
                      </div>
                      <Badge tone={SLA_TONE[sla]}>
                        {candidateSlaLabel(sla, assignment.responseDueAt)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={card.muted}>
                {isClosed
                  ? 'Назначения закрыты вместе со статусом кандидата.'
                  : 'Ответственный менеджер не назначен.'}
              </p>
            )}
          </Surface>

          <Surface className={card.section}>
            <div className={card.sectionHeader}>
              <h2 className={card.sectionTitle}>История назначений</h2>
            </div>
            {candidate.assignments.length ? (
              <ol className={card.timeline}>
                {candidate.assignments.map((assignment) => (
                  <li key={assignment.id} className={card.timelineItem}>
                    <div className={card.timelineHead}>
                      <strong>{assignment.manager.fullName || assignment.manager.login}</strong>
                      <time dateTime={assignment.assignedAt}>{formatDateTime(assignment.assignedAt)}</time>
                    </div>
                    <p className={card.subtle}>
                      {assignment.object?.name ?? 'Без объекта рассмотрения'} · назначил{' '}
                      {assignment.assignedBy.fullName}
                    </p>
                    <p className={card.subtle}>
                      {assignment.firstRespondedAt
                        ? `Ответ ${formatDateTime(assignment.firstRespondedAt)}`
                        : 'Ответа не было'}
                      {assignment.endedAt
                        ? ` · закрыто ${formatDateTime(assignment.endedAt)}`
                        : ' · активно'}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={card.muted}>Назначений пока нет.</p>
            )}
          </Surface>
        </div>
      </div>

      <ConfirmDialog
        open={archiveOpen && isIntentCurrent('archive')}
        onOpenChange={(open) => { if (!open) cancelCandidateIntent(); }}
        title="Архивировать кандидата?"
        consequence="Кандидат будет перемещён в архив."
        confirmLabel="Архивировать"
        tone="danger"
        pending={saving}
        error={error}
        onConfirm={() => {
          const isCurrent = (): boolean => candidateIntentRef.current === candidateIntent && candidateIntent?.isCurrent() === true;
          if (!isIntentCurrent('archive') || !isCurrent()) return;
          void mutate(() =>
            setCandidateArchive(candidate.id, candidate.version),
            isCurrent,
          ).then((success) => {
            if (success) setArchiveOpen(false);
          });
        }}
      />
      <Dialog
        open={Boolean(statusTarget) && isIntentCurrent('status')}
        onOpenChange={(open) => {
          if (!open && isIntentCurrent('status')) cancelCandidateIntent();
        }}
        title={
          reopening
            ? `Вернуть кандидата в статус «${candidateStatusLabel(statusTarget ?? 'in_progress')}»?`
            : `Перевести в статус «${candidateStatusLabel(statusTarget ?? 'accepted')}»?`
        }
        busy={saving}
        footer={
          <div className="ui-inline">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={cancelCandidateIntent}
            >
              Отмена
            </Button>
            <Button
              variant="primary"
              pending={saving}
              disabled={
                reopenNeedsManagers &&
                !candidateManagersValid(reopenManagers, true)
              }
              onClick={confirmStatusChange}
            >
              {reopening ? 'Вернуть в работу' : 'Изменить статус'}
            </Button>
          </div>
        }
      >
        <div className={styles.stack}>
          {reopening ? (
            <>
              <p className={styles.hint}>
                Предыдущие назначения были закрыты. Выберите ответственных
                менеджеров — им снова начнёт считаться срок обратной связи.
              </p>
              <CandidateManagerFields
                rows={reopenManagers}
                onChange={setReopenManagers}
                defaultObject={candidate.object}
                disabled={saving}
                requireManager
              />
            </>
          ) : (
            <p>
              Активные назначения менеджеров будут закрыты
              {activeAssignments.length
                ? ` (${activeAssignments.length})`
                : ''}
              . При возврате в работу менеджеров нужно будет выбрать снова.
            </p>
          )}
          {error ? (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          ) : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={converting && isIntentCurrent('convert')}
        onOpenChange={(open) => { if (!open) cancelCandidateIntent(); }}
        title="Оформить сотрудником?"
        confirmLabel="Оформить сотрудником"
        pending={saving}
        error={conversionError}
        consequence={
          <div className={styles.stack}>
            <p>В карточку сотрудника будут перенесены:</p>
            <ul className={styles.transferList}>
              <li>
                <span>ФИО</span>
                <strong>{candidate.fullName}</strong>
              </li>
              <li>
                <span>Основной телефон</span>
                <strong>{phones[0] ?? 'Не указан'}</strong>
              </li>
              {phones.length > 1 ? (
                <li>
                  <span>Другие телефоны</span>
                  <span>{phones.slice(1).join(', ')} — в примечание</span>
                </li>
              ) : null}
              {candidate.comment ? (
                <li>
                  <span>Комментарий</span>
                  <span>в примечание</span>
                </li>
              ) : null}
            </ul>
            <p className={styles.hint}>
              Назначение на объект и ставка задаются в карточке сотрудника.
            </p>
            <SearchableSelect
              label="Тип сотрудника"
              value={employeeType}
              options={CANDIDATE_EMPLOYEE_TYPE_OPTIONS}
              clearable={false}
              disabled={saving}
              onChange={(value) =>
                setEmployeeType(value as CandidateEmployeeType)
              }
            />
          </div>
        }
        onConfirm={() => {
          const isCurrent = (): boolean => candidateIntentRef.current === candidateIntent && candidateIntent?.isCurrent() === true;
          if (saving || !isIntentCurrent('convert') || !isCurrent()) return;
          const sequence = ++mutationSequence.current;
          setSaving(true);
          setConversionError(null);
          void convertCandidateToEmployee(
            candidate.id,
            employeeType,
            candidate.version,
          )
            .then((next) => {
              if (!isCurrent()) return;
              apply(next);
              setConverting(false);
              if (next.employeeId && next.capabilities.canViewEmployee)
                router.push(`/employees/${next.employeeId}`);
            })
            .catch((caughtError) => {
              if (!isCurrent()) return;
              setConversionError(
                caughtError instanceof Error
                  ? caughtError.message
                  : 'Не удалось оформить сотрудника.',
              );
            })
            .finally(() => { if (sequence === mutationSequence.current) setSaving(false); });
        }}
      />
      </AccessSnapshotBoundary>
    </div>
  );
}
