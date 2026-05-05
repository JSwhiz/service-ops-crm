'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  approveApprovalRequest,
  cancelApprovalRequest,
  listApprovalRequests,
  rejectApprovalRequest,
} from '@/entities/approval/api/approval-client';
import type { ApprovalRequestItem } from '@/entities/approval/model/approval.types';
import {
  APPROVAL_STATUS_OPTIONS,
  APPROVAL_TYPE_OPTIONS,
  getApprovalStatusLabel,
  getApprovalTypeLabel,
} from '@/shared/lib/approval-presentation';
import { getUserDisplayName } from '@/shared/lib/display-name';
import { PageTitle } from '@/shared/ui/page-title/page-title';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function ApprovalsPage(): React.JSX.Element {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ApprovalRequestItem[]>([]);
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [approvalType, setApprovalType] = useState(
    searchParams.get('approvalType') ?? '',
  );
  const [sourceEntityType, setSourceEntityType] = useState(
    searchParams.get('sourceEntityType') ?? '',
  );
  const [sourceEntityId, setSourceEntityId] = useState(
    searchParams.get('sourceEntityId') ?? '',
  );
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const loadRequests = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await listApprovalRequests({
        status: status || undefined,
        approvalType: approvalType || undefined,
        sourceEntityType: sourceEntityType || undefined,
        sourceEntityId: sourceEntityId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setItems(response);
    } catch (loadError) {
      setError(
        getErrorMessage(loadError, 'Не удалось загрузить очередь согласований.'),
      );
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, [status, approvalType, sourceEntityType, sourceEntityId, dateFrom, dateTo]);

  return (
    <>
      <PageTitle title="Согласования" />

      <div className="page-stack">
        <div className="page-card" style={{ display: 'grid', gap: 14 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Очередь подтверждений</div>
              <div className="section-subtitle">
                Shared approvals queue. Новые записи показываются сверху.
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <label>
              <div style={{ marginBottom: 6 }}>Статус</div>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {APPROVAL_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Тип</div>
              <select
                value={approvalType}
                onChange={(event) => setApprovalType(event.target.value)}
              >
                {APPROVAL_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Source type</div>
              <input
                value={sourceEntityType}
                onChange={(event) => setSourceEntityType(event.target.value)}
                placeholder="task / inventory_movement"
              />
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Source id</div>
              <input
                value={sourceEntityId}
                onChange={(event) => setSourceEntityId(event.target.value)}
                placeholder="UUID source entity"
              />
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Дата от</div>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>

            <label>
              <div style={{ marginBottom: 6 }}>Дата до</div>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
          </div>

          <div className="action-row">
            <button
              type="button"
              onClick={() => {
                setStatus('');
                setApprovalType('');
                setSourceEntityType('');
                setSourceEntityId('');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="page-card">Загрузка согласований...</div>
        ) : error ? (
          <div className="page-card" style={{ color: '#b91c1c' }}>
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="page-card">Подходящих approval requests пока нет.</div>
        ) : (
          <div className="record-list local-scroll">
            {items.map((item) => (
              <div key={item.id} className="record-card" style={{ display: 'grid', gap: 12 }}>
                <div className="section-header" style={{ paddingBottom: 0 }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <strong>{item.summary.title}</strong>
                    <div className="page-muted">
                      {item.summary.subtitle ?? 'Без дополнительного описания'}
                    </div>
                  </div>
                  <span className="status-pill" data-status={item.status}>
                    {getApprovalStatusLabel(item.status)}
                  </span>
                </div>

                <div className="detail-grid">
                  <div className="detail-field">
                    <div className="detail-label">Тип</div>
                    <div className="detail-value">
                      {getApprovalTypeLabel(item.approvalType)}
                    </div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Source</div>
                    <div className="detail-value">
                      {item.sourceEntityType} · {item.sourceEntityId.slice(0, 8)}
                    </div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Создано</div>
                    <div className="detail-value">
                      {new Date(item.createdAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <div className="detail-field">
                    <div className="detail-label">Инициатор</div>
                    <div className="detail-value">
                      {getUserDisplayName(item.createdBy)}
                    </div>
                  </div>
                </div>

                {'resultText' in item.payloadSnapshot &&
                typeof item.payloadSnapshot.resultText === 'string' &&
                item.payloadSnapshot.resultText.trim() ? (
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {item.payloadSnapshot.resultText}
                  </div>
                ) : null}

                {item.decisionComment ? (
                  <div className="record-card" style={{ background: '#f8fafc' }}>
                    Комментарий решения: {item.decisionComment}
                  </div>
                ) : null}

                <div className="action-row">
                  {item.capabilities.canApprove ? (
                    <button
                      type="button"
                      disabled={actingId === item.id}
                      onClick={() => {
                        setActingId(item.id);
                        void approveApprovalRequest(item.id)
                          .then(loadRequests)
                          .catch((approveError) => {
                            setError(
                              getErrorMessage(
                                approveError,
                                'Не удалось подтвердить approval request.',
                              ),
                            );
                          })
                          .finally(() => {
                            setActingId(null);
                          });
                      }}
                    >
                      Подтвердить
                    </button>
                  ) : null}

                  {item.capabilities.canReject ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(item.id);
                        setRejectComment('');
                      }}
                    >
                      Отклонить
                    </button>
                  ) : null}

                  {item.capabilities.canCancel ? (
                    <button
                      type="button"
                      disabled={actingId === item.id}
                      onClick={() => {
                        setActingId(item.id);
                        void cancelApprovalRequest(item.id)
                          .then(loadRequests)
                          .catch((cancelError) => {
                            setError(
                              getErrorMessage(
                                cancelError,
                                'Не удалось отменить approval request.',
                              ),
                            );
                          })
                          .finally(() => {
                            setActingId(null);
                          });
                      }}
                    >
                      Отменить
                    </button>
                  ) : null}

                  {item.sourceEntityType === 'task' ? (
                    <Link href={`/tasks/${item.sourceEntityId}`}>Открыть задачу</Link>
                  ) : item.sourceEntityType === 'object' ? (
                    <Link href={`/objects/${item.sourceEntityId}`}>Открыть объект</Link>
                  ) : item.sourceEntityType === 'inventory_movement' &&
                    typeof item.payloadSnapshot.inventoryItemId === 'string' ? (
                    <Link href={`/inventory/${item.payloadSnapshot.inventoryItemId}`}>
                      Открыть расходник
                    </Link>
                  ) : item.sourceEntityType === 'equipment_movement' &&
                    typeof item.payloadSnapshot.equipmentUnitId === 'string' ? (
                    <Link href={`/equipment/${item.payloadSnapshot.equipmentUnitId}`}>
                      Открыть оборудование
                    </Link>
                  ) : item.sourceEntityType === 'timesheet_exception' &&
                    typeof item.payloadSnapshot.objectId === 'string' &&
                    typeof item.payloadSnapshot.year === 'number' &&
                    typeof item.payloadSnapshot.month === 'number' ? (
                    <Link
                      href={`/timesheet?objectId=${item.payloadSnapshot.objectId}&year=${item.payloadSnapshot.year}&month=${item.payloadSnapshot.month}`}
                    >
                      Открыть табель
                    </Link>
                  ) : item.sourceEntityType === 'accountability_closure' ? (
                    <Link href="/accountability">Открыть подотчет</Link>
                  ) : null}
                </div>

                {rejectingId === item.id ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <textarea
                      rows={3}
                      value={rejectComment}
                      onChange={(event) => setRejectComment(event.target.value)}
                      placeholder="Укажите причину отклонения"
                    />
                    <div className="action-row">
                      <button
                        type="button"
                        disabled={actingId === item.id || !rejectComment.trim()}
                        onClick={() => {
                          setActingId(item.id);
                          void rejectApprovalRequest(item.id, rejectComment)
                            .then(loadRequests)
                            .then(() => {
                              setRejectingId(null);
                              setRejectComment('');
                            })
                            .catch((rejectError) => {
                              setError(
                                getErrorMessage(
                                  rejectError,
                                  'Не удалось отклонить approval request.',
                                ),
                              );
                            })
                            .finally(() => {
                              setActingId(null);
                            });
                        }}
                      >
                        Подтвердить отклонение
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingId(null);
                          setRejectComment('');
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
