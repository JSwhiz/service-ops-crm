'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';

import {
  createCandidate,
  listCandidateManagers,
} from '@/entities/candidate/api/candidate-client';
import { CANDIDATE_TYPE_OPTIONS } from '@/entities/candidate/lib/candidate-presentation';
import type { CandidateType } from '@/entities/candidate/model/candidate.types';
import { listObjectsPage } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/shared/ui/searchable-select/searchable-select';

function toObjectOption(object: ServiceObject): SearchableSelectOption {
  return {
    value: object.id,
    label: object.name,
    description: [object.internalName, object.address].filter(Boolean).join(' · '),
    searchText: [object.name, object.internalName, object.address]
      .filter(Boolean)
      .join(' '),
  };
}

export default function NewCandidatePage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [candidateType, setCandidateType] = useState<CandidateType>('regular');
  const [objectId, setObjectId] = useState('');
  const [managerUserId, setManagerUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!(user?.capabilities?.canManageCandidates ?? false)) {
    return (
      <>
        <PageTitle title="Новый кандидат" />
        <div className="page-card">Недостаточно прав.</div>
      </>
    );
  }

  const regularReferencesMissing =
    candidateType === 'regular' && (!objectId || !managerUserId);

  return (
    <>
      <PageTitle title="Новый кандидат" />
      <form
        className="page-card candidate-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (regularReferencesMissing) {
            setError(
              'Для обычного кандидата выберите объект и ответственного менеджера.',
            );
            return;
          }

          setSaving(true);
          setError(null);
          void createCandidate({
            fullName: fullName.trim(),
            phone: phone.trim(),
            comment: comment.trim() || undefined,
            candidateType,
            objectId: objectId || null,
            managerUserId: managerUserId || null,
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
        <label>
          <span>ФИО *</span>
          <input
            required
            minLength={2}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>

        <label>
          <span>Телефон *</span>
          <input
            required
            minLength={3}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>

        <SearchableSelect
          label="Тип *"
          value={candidateType}
          options={CANDIDATE_TYPE_OPTIONS}
          clearable={false}
          onChange={(value) => setCandidateType(value as CandidateType)}
        />

        <SearchableSelect
          label={candidateType === 'regular' ? 'Объект *' : 'Объект'}
          value={objectId}
          options={[]}
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
          onChange={setObjectId}
        />

        <SearchableSelect
          label={
            candidateType === 'regular'
              ? 'Ответственный менеджер *'
              : 'Ответственный менеджер'
          }
          value={managerUserId}
          options={[]}
          placeholder="Назначить позже"
          searchPlaceholder="ФИО или логин"
          emptyText="Подходящие менеджеры не найдены"
          asyncSearch={async (query) =>
            (await listCandidateManagers({ q: query })).map((manager) => ({
              value: manager.id,
              label: manager.fullName || manager.login,
              description: `@${manager.login}`,
              searchText: `${manager.fullName} ${manager.login}`,
            }))
          }
          onChange={setManagerUserId}
        />

        <label className="candidate-form__wide">
          <span>Комментарий</span>
          <textarea
            rows={4}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>

        {candidateType === 'reserve' ? (
          <div className="page-muted candidate-form__wide">
            Для резервного кандидата объект и менеджер можно назначить позже.
          </div>
        ) : null}

        {error ? (
          <div className="inline-notice inline-notice--warning candidate-form__wide">
            {error}
          </div>
        ) : null}

        <div className="action-row candidate-form__wide">
          <button
            type="button"
            className="button-secondary"
            onClick={() => router.back()}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              fullName.trim().length < 2 ||
              phone.trim().length < 3 ||
              regularReferencesMissing
            }
          >
            {saving ? 'Сохраняем...' : 'Создать'}
          </button>
        </div>
      </form>
    </>
  );
}
