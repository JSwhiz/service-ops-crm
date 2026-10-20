'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

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
  CandidateStatus,
  CandidateType,
} from '@/entities/candidate/model/candidate.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import { Button, Field } from '@/shared/ui/foundation';
import { ConfirmDialog } from '@/shared/ui/overlays';
import {
  CandidateManagerFields,
  CandidatePhoneFields,
  candidatePhoneDrafts,
  candidateManagerDrafts,
  candidateManagerPayload,
  candidateManagersValid,
  type CandidateManagerDraft,
} from '@/features/candidate-registry/ui/candidate-fields';
import styles from '@/features/candidate-registry/ui/candidate-fields.module.css';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

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

export default function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): React.JSX.Element {
  const [candidate, setCandidate] = useState<CandidateCard | null>(null);
  const router = useRouter();
  const [managers, setManagers] = useState<CandidateManagerDraft[]>([]);
  const [editingManagers, setEditingManagers] = useState(false);
  const [converting, setConverting] = useState(false);
  const [employeeType, setEmployeeType] =
    useState<CandidateEmployeeType>('regular');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [, setClock] = useState(0);
  const [responseText, setResponseText] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phones: candidatePhoneDrafts(['']),
    comment: '',
    candidateType: 'regular' as CandidateType,
    objectId: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncForm = (item: CandidateCard): void => {
    setForm({
      fullName: item.fullName,
      phones: candidatePhoneDrafts(candidatePhones(item)),
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
    void params
      .then(({ id }) => getCandidate(id))
      .then((item) => {
        if (active) {
          setCandidate(item);
          syncForm(item);
        }
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить кандидата.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params]);

  const apply = (next: CandidateCard): void => {
    setCandidate(next);
    syncForm(next);
  };

  const mutate = async (
    operation: () => Promise<CandidateCard>,
  ): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      apply(await operation());
      return true;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Не удалось сохранить изменение. Обновите карточку и повторите.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageTitle title="Кандидат" />
        <div className="page-card">Загрузка...</div>
      </>
    );
  }

  if (!candidate) {
    return (
      <>
        <PageTitle title="Кандидат" />
        <div className="page-card inline-notice inline-notice--warning">
          {error ?? 'Кандидат не найден.'}
        </div>
      </>
    );
  }

  const activeAssignments = candidateActiveAssignments(candidate);
  const canEditManagers =
    candidate.capabilities.canManage &&
    !candidate.deletedAt &&
    !['accepted', 'rejected'].includes(candidate.status);
  const regularObjectMissing =
    form.candidateType === 'regular' && !form.objectId;

  return (
    <div className="workspace-page candidate-detail-page">
      <PageTitle title={candidate.fullName} />
      <div className="page-stack candidate-card-page">
        <div className="action-row">
          <Link href="/candidates">К реестру</Link>
          {candidate.employeeId ? (
            candidate.capabilities.canViewEmployee ? (
              <Link href={`/employees/${candidate.employeeId}`}>
                Открыть сотрудника
              </Link>
            ) : (
              <span>Сотрудник оформлен</span>
            )
          ) : candidate.capabilities.canConvert ? (
            <Button
              variant="primary"
              disabled={saving}
              onClick={() => {
                setConversionError(null);
                setConverting(true);
              }}
            >
              Оформить сотрудником
            </Button>
          ) : null}
          {candidate.deletedAt ? (
            <span className="status-pill">В архиве</span>
          ) : null}
        </div>

        {error ? (
          <div className="page-card inline-notice inline-notice--warning">
            {error}
          </div>
        ) : null}

        <section className="page-card candidate-summary">
          <div>
            <span className="detail-label">Телефон</span>
            <div className={styles.phones}>
              {candidatePhones(candidate).length
                ? candidatePhones(candidate).map((phone, index) => (
                    <strong key={index}>{phone}</strong>
                  ))
                : 'Не указан'}
            </div>
          </div>
          <div>
            <span className="detail-label">Тип</span>
            <strong>{candidateTypeLabel(candidate.candidateType)}</strong>
          </div>
          <div>
            <span className="detail-label">Объект</span>
            <strong>{candidate.object?.name ?? 'Не указан'}</strong>
          </div>
          <div>
            <span className="detail-label">Статус</span>
            <strong>{candidateStatusLabel(candidate.status)}</strong>
          </div>
          <div className="candidate-sla-row">
            <span className="detail-label">SLA</span>
            <span className={`candidate-sla candidate-sla--${candidate.slaState}`}>
              {candidateSlaLabel(candidate.slaState)}
            </span>
          </div>
        </section>

        <section className={`candidate-detail-grid ${styles.detailGrid}`}>
          <div className="page-card">
            <div className="section-header">
              <div className="section-title">Данные кандидата</div>
              {candidate.capabilities.canManage ? (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={saving}
                  onClick={() => {
                    syncForm(candidate);
                    setEditing((value) => !value);
                  }}
                >
                  {editing ? 'Отмена' : 'Редактировать'}
                </button>
              ) : null}
            </div>

            {editing ? (
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (regularObjectMissing) {
                    setError('Для обычного кандидата требуется объект.');
                    return;
                  }
                  void mutate(() =>
                    updateCandidate(candidate.id, {
                      expectedVersion: candidate.version,
                      fullName: form.fullName,
                      phone: form.phones[0]?.value.trim() || null,
                      phones: form.phones.map((phone) => phone.value.trim()),
                      comment: form.comment || null,
                      candidateType: form.candidateType,
                      objectId: form.objectId || null,
                    }),
                  ).then((success) => {
                    if (success) setEditing(false);
                  });
                }}
              >
                <fieldset className={`${styles.section} ${styles.full}`} disabled={saving}>
                  <legend>Основное</legend>
                  <div className={styles.sectionGrid}>
                    <Field className={styles.field} label="ФИО" required>
                      <input
                        required
                        minLength={2}
                        maxLength={200}
                        value={form.fullName}
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            fullName: event.target.value,
                          }))
                        }
                      />
                    </Field>
                    <SearchableSelect
                      label="Тип"
                      value={form.candidateType}
                      options={CANDIDATE_TYPE_OPTIONS}
                      clearable={false}
                      disabled={saving}
                      onChange={(value) =>
                        setForm((currentForm) => ({
                          ...currentForm,
                          candidateType: value as CandidateType,
                        }))
                      }
                    />
                    <div className={styles.full}>
                      <CandidatePhoneFields
                        phones={form.phones}
                        onChange={(phones) =>
                          setForm((value) => ({ ...value, phones }))
                        }
                        disabled={saving}
                      />
                    </div>
                  </div>
                </fieldset>
                <fieldset className={`${styles.section} ${styles.full}`} disabled={saving}>
                  <legend>Привязка</legend>
                  <SearchableSelect
                    label={form.candidateType === 'regular' ? 'Объект *' : 'Объект'}
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
                      setForm((currentForm) => ({
                        ...currentForm,
                        objectId: value,
                      }))
                    }
                  />
                  <div className={styles.hint}>
                    Объекты, по которым кандидата рассматривают менеджеры, изменяются в блоке «Ответственные менеджеры».
                  </div>
                </fieldset>
                <fieldset className={`${styles.section} ${styles.full}`} disabled={saving}>
                  <legend>Дополнительно</legend>
                  <Field className={styles.field} label="Комментарий">
                    <textarea
                      rows={4}
                      maxLength={2000}
                      value={form.comment}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          comment: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </fieldset>
                <div className={`${styles.actions} ${styles.full}`}>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      saving ||
                      regularObjectMissing ||
                      form.phones.some((phone) => phone.value.trim().length < 3)
                    }
                  >
                    Сохранить
                  </Button>
                </div>
              </form>
            ) : (
              <div className="candidate-comment">
                {candidate.comment || 'Комментарий не указан.'}
              </div>
            )}
          </div>

          <div className="page-card">
            <h2 className="section-title">Ответственные менеджеры</h2>
            {activeAssignments.length ? (
              activeAssignments.map((assignment) => {
                const sla = candidateAssignmentSla(assignment);
                return (
                  <div key={assignment.id} className={styles.assignment}>
                    <strong>
                      {assignment.manager.fullName || assignment.manager.login}
                    </strong>
                    <span>
                      {assignment.object?.name ?? 'Без объекта рассмотрения'}
                    </span>
                    {assignment.object ? (
                      <span className="page-muted">
                        {[
                          assignment.object.internalName,
                          assignment.object.address,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                    <span className="page-muted">
                      Назначен{' '}
                      {new Date(assignment.assignedAt).toLocaleString('ru-RU')}
                    </span>
                    <span className={styles[sla]}>
                      {candidateSlaLabel(sla, assignment.responseDueAt)}
                    </span>
                    <span className="page-muted">
                      Обратная связь до{' '}
                      {new Date(assignment.responseDueAt).toLocaleString(
                        'ru-RU',
                      )}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="page-muted">Активных назначений нет.</div>
            )}
            {canEditManagers ? (
              editingManagers ? (
                <div className="candidate-manager-control">
                  <CandidateManagerFields
                    rows={managers}
                    onChange={setManagers}
                    defaultObject={candidate.object}
                    disabled={saving}
                  />
                  <div className="action-row">
                    <Button
                      disabled={saving}
                      onClick={() => setEditingManagers(false)}
                    >
                      Отмена
                    </Button>
                    <Button
                      variant="primary"
                      pending={saving}
                      disabled={!candidateManagersValid(managers)}
                      onClick={() => {
                        void mutate(() =>
                          assignCandidateManagers(
                            candidate.id,
                            candidateManagerPayload(
                              managers,
                              candidate.object?.id ?? null,
                            ),
                            candidate.version,
                          ),
                        ).then((success) => {
                          if (success) setEditingManagers(false);
                        });
                      }}
                    >
                      Сохранить менеджеров
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={saving}
                  onClick={() => {
                    setManagers(candidateManagerDrafts(activeAssignments));
                    setEditingManagers(true);
                  }}
                >
                  Изменить менеджеров
                </Button>
              )
            ) : null}
          </div>
        </section>

        {candidate.capabilities.canManage ? (
          <section className="page-card candidate-actions">
            <SearchableSelect
              label="Статус"
              value={candidate.status}
              options={CANDIDATE_STATUS_OPTIONS}
              clearable={false}
              disabled={saving}
              onChange={(value) =>
                void mutate(() =>
                  changeCandidateStatus(
                    candidate.id,
                    value as CandidateStatus,
                    candidate.version,
                  ),
                )
              }
            />
            <div className="action-row">
              {candidate.capabilities.canArchive ? (
                <button
                  type="button"
                  className="button-danger"
                  disabled={saving}
                  onClick={() => setArchiveOpen(true)}
                >
                  Архивировать
                </button>
              ) : null}
              {candidate.capabilities.canRestore ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void mutate(() =>
                      setCandidateArchive(
                        candidate.id,
                        candidate.version,
                        true,
                      ),
                    )
                  }
                >
                  Восстановить
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className={`candidate-detail-grid ${styles.detailGrid}`}>
          <div className="page-card">
            <div className="section-title">Обратная связь по кандидату</div>
            {candidate.responses.length ? (
              <div className="candidate-history">
                {candidate.responses.map((response) => (
                  <article key={response.id}>
                    <div>
                      <strong>{response.author.fullName}</strong>
                      <time>
                        {new Date(response.createdAt).toLocaleString('ru-RU')}
                      </time>
                    </div>
                    <p>{response.text}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="page-muted">Обратной связи пока нет.</div>
            )}

            {candidate.capabilities.canRespond ? (
              <form
                className={`candidate-response-form ${styles.feedbackForm}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = responseText.trim();
                  if (!text) return;
                  void mutate(() =>
                    addCandidateResponse(candidate.id, text),
                  ).then((success) => {
                    if (success) setResponseText('');
                  });
                }}
              >
                <label>
                  <span>Обратная связь</span>
                  <textarea
                    rows={3}
                    required
                    value={responseText}
                    onChange={(event) => setResponseText(event.target.value)}
                    placeholder="Например: подходит, готов взять; не дозвонился; перезвонить позже"
                  />
                </label>
                <button type="submit" disabled={saving || !responseText.trim()}>
                  Дать ответ о кандидате
                </button>
              </form>
            ) : null}
          </div>

          <div className="page-card">
            <div className="section-title">История назначений</div>
            {candidate.assignments.length ? (
              <div className="candidate-history">
                {candidate.assignments.map((assignment) => (
                  <article key={assignment.id}>
                    <div>
                      <strong>{assignment.manager.fullName}</strong>
                      <time>
                        {new Date(assignment.assignedAt).toLocaleString(
                          'ru-RU',
                        )}
                      </time>
                    </div>
                    <p>Назначил: {assignment.assignedBy.fullName}</p>
                    <p>
                      Объект рассмотрения:{' '}
                      {assignment.object?.name ?? 'Не указан'}
                    </p>
                    <p>
                      {assignment.firstRespondedAt
                        ? `Первая обратная связь: ${new Date(
                            assignment.firstRespondedAt,
                          ).toLocaleString('ru-RU')}`
                        : 'Обратная связь не получена'}
                      {assignment.endedAt
                        ? ` · Завершено ${new Date(
                            assignment.endedAt,
                          ).toLocaleString('ru-RU')}`
                        : ''}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="page-muted">Назначений пока нет.</div>
            )}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Архивировать кандидата?"
        consequence="Кандидат будет перемещён в архив."
        confirmLabel="Архивировать"
        tone="danger"
        pending={saving}
        error={error}
        onConfirm={() => {
          void mutate(() =>
            setCandidateArchive(candidate.id, candidate.version),
          ).then((success) => {
            if (success) setArchiveOpen(false);
          });
        }}
      />
      <ConfirmDialog
        open={converting}
        onOpenChange={setConverting}
        title="Оформить сотрудником?"
        confirmLabel="Оформить сотрудником"
        pending={saving}
        error={conversionError}
        consequence={
          <div className={styles.stack}>
            <p>
              Будет создана карточка сотрудника. Назначение на объект
              выполняется отдельно.
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
          if (saving) return;
          setSaving(true);
          setConversionError(null);
          void convertCandidateToEmployee(
            candidate.id,
            employeeType,
            candidate.version,
          )
            .then((next) => {
              apply(next);
              setConverting(false);
              if (next.employeeId && next.capabilities.canViewEmployee)
                router.push(`/employees/${next.employeeId}`);
            })
            .catch((caughtError) =>
              setConversionError(
                caughtError instanceof Error
                  ? caughtError.message
                  : 'Не удалось оформить сотрудника.',
              ),
            )
            .finally(() => setSaving(false));
        }}
      />
    </div>
  );
}
