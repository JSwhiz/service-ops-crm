'use client';

import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

import { captureObjectWriteFence } from '@/features/object-shared-ui/object-write-fence';
import { AccessSnapshotBlockedContext } from '@/shared/auth/access-snapshot-boundary';
import { isSavedWithoutAccess, type SavedWithoutAccess } from '@/shared/api/saved-without-access';
import { ApiError } from '@/shared/api/fetcher';
import type { ObjectAssignedUser } from '@/entities/object/model/object.types';
import type { SystemUserOption } from '@/entities/user/model/user.types';
import {
  getUserDisplayName,
  getUserSecondaryLabel,
} from '@/shared/lib/display-name';
import { SearchableSelect } from '@/shared/ui/searchable-select/searchable-select';
import { MediaActionIcon } from '@/shared/ui/app-shell/media-action-icon';

import { Dialog } from '@/shared/ui/overlays';
import styles from './object-team-panel.module.css';
import { Alert, Button, Surface } from '@/shared/ui/foundation';

interface ObjectTeamPanelProps {
  objectId: string;
  title: string;
  currentItems: ObjectAssignedUser[];
  availableUsers: SystemUserOption[];
  emptyCurrentText: string;
  emptyAvailableText: string;
  addButtonText: string;
  removeButtonText: string;
  minimumItemsToKeep?: number;
  replaceOnly?: boolean;
  onAdd: (userId: string) => Promise<void | SavedWithoutAccess>;
  onRemove: (userId: string) => Promise<void | SavedWithoutAccess>;
}

export function ObjectTeamPanel({
  objectId,
  title,
  currentItems,
  availableUsers,
  emptyCurrentText,
  emptyAvailableText,
  addButtonText,
  removeButtonText,
  minimumItemsToKeep = 0,
  replaceOnly = false,
  onAdd,
  onRemove,
}: ObjectTeamPanelProps): React.JSX.Element {
  const mounted = useRef(true), currentObjectId = useRef(objectId), busy = useRef(false);
  currentObjectId.current = objectId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocked = useContext(AccessSnapshotBlockedContext), currentBlocked = useRef(blocked); currentBlocked.current = blocked;
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReplacementOpen, setIsReplacementOpen] = useState(false);
  const replacementFormId = useId();
  const currentIds = useMemo(() => new Set(currentItems.map((item) => item.userId)), [currentItems]);

  const options = availableUsers
    .filter((user) => !currentIds.has(user.id))
    .map((user) => ({
      value: user.id,
      label: getUserDisplayName(user),
      description: getUserSecondaryLabel(user) || undefined,
      searchText: `${user.fullName} ${user.login}`,
    }));

  const runChange = async (write: () => Promise<void | SavedWithoutAccess>, closeReplacement: boolean): Promise<void> => {
    if (busy.current || currentBlocked.current || acknowledged) return;
    const targetId = objectId;
    const fence = captureObjectWriteFence(() => mounted.current && currentObjectId.current === targetId);
    busy.current = true; setIsSubmitting(true); setError(null);
    try {
      const result = await write();
      if (!fence.sameTarget()) return;
      if ((result && isSavedWithoutAccess(result)) || !fence.current() || currentBlocked.current) {
        setAcknowledged(true); setIsReplacementOpen(false); return;
      }
      if (closeReplacement) { setSelectedUserId(''); setIsReplacementOpen(false); }
    } catch (caught) {
      if (!fence.sameTarget()) return;
      setError(caught instanceof ApiError && [403, 404].includes(caught.statusCode)
        ? 'Изменение команды недоступно. Выбранные данные сохранены.'
        : 'Результат изменения не подтверждён. Проверьте данные перед повтором; выбранный пользователь сохранён.');
    } finally { busy.current = false; if (fence.sameTarget()) setIsSubmitting(false); }
  };
  const handleAdd = (userId: string): void => {
    if (!userId || !options.some(option => option.value === userId)) return;
    setSelectedUserId(userId); void runChange(() => onAdd(userId), true);
  };
  const handleRemove = (userId: string): void => { void runChange(() => onRemove(userId), false); };

  return (
    <Surface padding="md" className={`${styles.panel}`}>
      {acknowledged ? <Alert tone="success" role="status">Изменение сохранено без доступных подробностей. Повтор не отправлялся.
        <Button onClick={() => { setAcknowledged(false); setSelectedUserId(''); }}>Я проверил запись — новое действие</Button>
      </Alert> : null}
      <div className={styles.header}>
        <h3 className="ui-section-title">{title}</h3>
        {replaceOnly ? (
          <>
            <Button
              disabled={blocked || acknowledged || isSubmitting || options.length === 0}
              aria-haspopup="dialog"
              icon={<MediaActionIcon name="replace" />}
              onClick={() => { setError(null); setSelectedUserId(''); setIsReplacementOpen(true); }}
            >
              {currentItems.length ? 'Сменить' : 'Назначить'}
            </Button>
            <Dialog
              open={isReplacementOpen}
              onOpenChange={setIsReplacementOpen}
              title="Сменить ответственного"
              description="Выберите пользователя, который будет отвечать за объект."
              busy={isSubmitting}
              footer={<div className="ui-inline"><Button disabled={blocked || acknowledged || isSubmitting} onClick={() => setIsReplacementOpen(false)}>Отмена</Button><Button form={replacementFormId} type="submit" variant="primary" pending={isSubmitting} pendingLabel="Сохранение…" disabled={blocked || acknowledged || !selectedUserId}>Сохранить</Button></div>}
            >
              <form id={replacementFormId} className="ui-stack ui-stack--lg" onSubmit={(event) => { event.preventDefault(); handleAdd(selectedUserId); }}>
                <SearchableSelect label="Новый ответственный" value={selectedUserId} options={options} placeholder="Выберите пользователя" searchPlaceholder="ФИО или логин" emptyText={emptyAvailableText} clearable={false} viewportAware onChange={setSelectedUserId} disabled={blocked || acknowledged || isSubmitting} />
                {error ? <Alert tone="danger">{error}</Alert> : null}
              </form>
            </Dialog>
          </>
        ) : <span className={styles.count}>{currentItems.length}</span>}
      </div>

      <section className={styles.group}>
        {currentItems.length === 0 ? (
          <div className={styles.empty}>{emptyCurrentText}</div>
        ) : (
          <div className={styles.list}>
            {currentItems.map((item) => (
              <div key={item.userId} className={styles.row}>
                <span className={styles.identity}>
                  <strong>{getUserDisplayName(item)}</strong>
                  {getUserSecondaryLabel(item) ? (
                    <span>{getUserSecondaryLabel(item)}</span>
                  ) : null}
                </span>
                {!replaceOnly ? <Button
                  disabled={blocked || acknowledged || isSubmitting || currentItems.length <= minimumItemsToKeep}
                  title={currentItems.length <= minimumItemsToKeep ? 'Нельзя снять последнего ответственного' : undefined}
                  onClick={() => handleRemove(item.userId)}
                >
                  {removeButtonText}
                </Button> : null}
              </div>
            ))}
          </div>
        )}
        {!replaceOnly && currentItems.length > 0 && currentItems.length <= minimumItemsToKeep ? (
          <div className={styles.empty}>У объекта должен оставаться хотя бы один ответственный.</div>
        ) : null}
      </section>

      {!replaceOnly ? <div className={styles.addControl}>
        {options.length > 0 ? (
          <SearchableSelect
            label="Добавить"
            value={selectedUserId}
            options={options}
            placeholder={addButtonText}
            searchPlaceholder="ФИО или логин"
            emptyText={emptyAvailableText}
            clearable={false}
            viewportAware
            onChange={handleAdd}
            disabled={blocked || acknowledged || isSubmitting}
          />
        ) : (
          <div className={styles.empty}>{emptyAvailableText}</div>
        )}
      </div> : null}

      {replaceOnly && options.length === 0 ? <p className="ui-text-muted">{emptyAvailableText}</p> : null}
      {error && !isReplacementOpen ? <Alert tone="danger">{error}</Alert> : null}
    </Surface>
  );
}
