'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

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
import { Alert, Button, Field, Surface } from '@/shared/ui/foundation';
import { PageTitle } from '@/shared/ui/page-title/page-title';
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

export default function NewCandidatePage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phones, setPhones] = useState(() => phoneDrafts(['']));
  const [comment, setComment] = useState('');
  const [candidateType, setCandidateType] = useState<CandidateType>('regular');
  const [objectId, setObjectId] = useState('');
  const [managers, setManagers] = useState<CandidateManagerDraft[]>([]);
  const [selectedObject, setSelectedObject] = useState<ServiceObject | null>(
    null,
  );
  const objectOptions = React.useRef<ServiceObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!(user?.capabilities?.canManageCandidates ?? false)) {
    return (
      <>
        <PageTitle title="Новый кандидат" />
        <Surface padding="md">Недостаточно прав.</Surface>
      </>
    );
  }

  const regularReferencesMissing =
    candidateType === 'regular' && (!objectId || managers.length === 0);

  return (
    <>
      <PageTitle title="Новый кандидат" />
      <form
        className={`ui-surface ui-surface--padded ${styles.form}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (regularReferencesMissing || !candidateManagersValid(managers, candidateType === 'regular')) {
            setError(
              'Для обычного кандидата выберите объект и ответственного менеджера.',
            );
            return;
          }

          setSaving(true);
          setError(null);
          void createCandidate({
            fullName: fullName.trim(),
            phone: phoneDraftValues(phones)[0] ?? '',
            phones: phoneDraftValues(phones),
            comment: comment.trim() || undefined,
            candidateType,
            objectId: objectId || null,
            assignments: candidateManagerPayload(managers, objectId || null),
          })
            .then((candidate) => router.push(`/candidates/${candidate.id}`))
            .catch((caughtError) =>
              setError(
                caughtError instanceof Error
                  ? caughtError.message
                  : 'Не удалось создать кандидата.',
              ),
            )
            .finally(() => setSaving(false));
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

            <div className={styles.full}>
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
              setObjectId(value);
              setSelectedObject(
                objectOptions.current.find((item) => item.id === value) ?? null,
              );
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

        <div className={`${styles.actions} ${styles.full}`}>
          <Button disabled={saving} onClick={() => router.back()}>
            Отмена
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={
              saving ||
              fullName.trim().length < 2 ||
              !phoneDraftsValid(phones, true) ||
              !candidateManagersValid(managers, candidateType === 'regular') ||
              regularReferencesMissing
            }
          >
            {saving ? 'Сохраняем...' : 'Создать'}
          </Button>
        </div>
      </form>
    </>
  );
}
