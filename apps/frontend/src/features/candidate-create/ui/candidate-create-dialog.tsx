'use client';

import { useRouter } from 'next/navigation';
import React, { useRef, useState } from 'react';

import { createCandidate } from '@/entities/candidate/api/candidate-client';
import { CANDIDATE_TYPE_OPTIONS } from '@/entities/candidate/lib/candidate-presentation';
import type { CandidateType } from '@/entities/candidate/model/candidate.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { useAuth } from '@/shared/auth/use-auth';
import {
  CandidateManagerFields,
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
import createStyles from './candidate-create.module.css';
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';
import { FormDialog } from '@/shared/ui/overlays';
import { useCreateDraft } from '@/shared/drafts';
import { useCreateNavigation } from '@/shared/create-navigation';
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

export function CandidateCreateDialog(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const navigation = useCreateNavigation();
  const draft = useCreateDraft('candidate-create', {
    fullName: '', phones: phoneDrafts(['']), comment: '', candidateType: 'regular' as CandidateType,
    objectId: '', managers: [] as CandidateManagerDraft[], selectedObject: null as ServiceObject | null,
  });
  const { fullName, phones, comment, candidateType, objectId, managers, selectedObject } = draft.value;
  const update = <K extends keyof typeof draft.value>(key: K, value: typeof draft.value[K]): void => {
    const next = { ...draft.value, [key]: value };
    draft.setValue(next);
    draft.setDirty(Boolean(next.fullName || next.comment || next.objectId || next.managers.length || next.candidateType !== 'regular' || next.phones.some((phone) => phone.value)));
  };
  const setFullName = (value: string): void => update('fullName', value);
  const setPhones = (value: typeof phones): void => update('phones', value);
  const setComment = (value: string): void => update('comment', value);
  const setCandidateType = (value: CandidateType): void => update('candidateType', value);
  const setManagers = (value: CandidateManagerDraft[]): void => update('managers', value);
  const submitLock = useRef(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const fallbackQuery = navigation.getTargetSearchParams().toString();
  const closeContext = navigation.closeContext('/candidates' + (fallbackQuery ? '?' + fallbackQuery : ''));
  const objectOptions = React.useRef<ServiceObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localSaving, setSaving] = useState(false);
  const saving = localSaving || draft.submitting;

  const canManage = user?.capabilities?.canManageCandidates ?? false;

  const regularReferencesMissing =
    candidateType === 'regular' && (!objectId || managers.length === 0);

  return (
    <FormDialog open title="Новый кандидат" size="regular" busy={saving} dirty={draft.dirty} closeContext={closeContext} clearDraft={draft.clear}
      footer={({ requestClose }) => <div className={createStyles.footer}>
        <Button disabled={saving} onClick={() => void requestClose()}>Отмена</Button>
        {canManage ? <Button variant="primary" type="submit" form="candidate-create-form" pending={saving} disabled={Boolean(createdId) || fullName.trim().length < 2 || !phoneDraftsValid(phones, true) || !candidateManagersValid(managers, candidateType === 'regular') || regularReferencesMissing}>{createdId ? 'Создано' : 'Создать'}</Button> : null}
      </div>}>
      {canManage ?
      <form id="candidate-create-form"
        className={styles.form}
        onSubmit={(event) => {
          if (submitLock.current || saving || createdId || !canManage) { event.preventDefault(); return; }
          event.preventDefault();
          if (regularReferencesMissing || !candidateManagersValid(managers, candidateType === 'regular')) {
            setError(
              'Для обычного кандидата выберите объект и ответственного менеджера.',
            );
            return;
          }

          submitLock.current = true;
          setSaving(true);
          setError(null);
          void draft.submit(() => createCandidate({
            fullName: fullName.trim(),
            phone: phoneDraftValues(phones)[0] ?? '',
            phones: phoneDraftValues(phones),
            comment: comment.trim() || undefined,
            candidateType,
            objectId: objectId || null,
            assignments: candidateManagerPayload(managers, objectId || null),
          })).then((candidate) => {
            setCreatedId(candidate.id);
            draft.clear();
            setSaving(false);
            router.push('/candidates/' + candidate.id);
          }, (caught: unknown) => {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать кандидата.');
            submitLock.current = false;
            setSaving(false);
          });
        }}
      >
        <p className={`${styles.full} ui-text-muted`}>* — обязательные поля</p>
        <fieldset className={`${styles.section} ${styles.full}`} disabled={saving}>
          <legend>Основное</legend>
          <div className={styles.sectionGrid}>
            <Field className={`${styles.field} ${styles.full}`} label="ФИО" required>
              <input
                required
                minLength={2}
                maxLength={200}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </Field>

            <SearchableSelect
              label="Тип *"
              value={candidateType}
              options={CANDIDATE_TYPE_OPTIONS}
              clearable={false}
              disabled={saving}
              onChange={(value) => setCandidateType(value as CandidateType)}
            />

            <div className={createStyles.phoneArea}>
              <PhoneListField
                required
                phones={phones}
                onChange={setPhones}
                disabled={saving}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className={`${styles.section} ${styles.full}`} disabled={saving}>
          <legend>Рассмотрение</legend>
          <SearchableSelect
            label={candidateType === 'regular' ? 'Объект по умолчанию *' : 'Объект по умолчанию'}
            value={objectId}
            options={[]}
            selectedOption={selectedObject ? toObjectOption(selectedObject) : null}
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
              objectOptions.current = result.items;
              return result.items.map(toObjectOption);
            }}
            onChange={(value) => {
              const next = { ...draft.value, objectId: value, selectedObject: objectOptions.current.find((item) => item.id === value) ?? null };
              draft.setValue(next);
              draft.setDirty(true);
            }}
          />
          <div className={styles.hint}>
            Этот объект подставляется каждому менеджеру. При необходимости укажите другой объект в его строке.
          </div>
          <section>
            <h2 className="ui-section-title">
              Ответственные менеджеры{candidateType === 'regular' ? ' *' : ''}
            </h2>
          <CandidateManagerFields
            rows={managers}
            onChange={setManagers}
            defaultObject={selectedObject}
            disabled={saving}
            requireManager={candidateType === 'regular'}
          />
          </section>
        </fieldset>

        <fieldset className={`${styles.section} ${styles.full}`} disabled={saving}>
          <legend>Дополнительно</legend>
          <Field className={styles.field} label="Комментарий">
            <textarea
              rows={4}
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
        </fieldset>

        {candidateType === 'reserve' ? (
          <div className={`ui-text-muted ${styles.full}`}>
            Для резервного кандидата объект и менеджер можно назначить позже.
          </div>
        ) : null}

        {error ? (
          <Alert tone="warning" role="alert" className={styles.full}>
            {error}
          </Alert>
        ) : null}

        {createdId ? <Alert tone="success" role="status">Кандидат создан. <a href={'/candidates/' + createdId}>Открыть карточку</a></Alert> : null}
      </form>
      : <Surface padding="md">Недостаточно прав.</Surface>}
    </FormDialog>
  );
}
