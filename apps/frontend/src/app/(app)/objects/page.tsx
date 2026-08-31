'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import {
  listObjectsPage,
  type ObjectListPage,
  type ObjectSortField,
} from '@/entities/object/api/object-client';
import { ObjectListTable } from '@/features/object-list/ui/object-list-table';
import { useAuth } from '@/shared/auth/use-auth';
import { PageTitle } from '@/shared/ui/page-title/page-title';

const PAGE_LIMIT = 20;
const SORT_FIELDS = new Set<ObjectSortField>([
  'name',
  'internalName',
  'status',
  'updatedAt',
  'createdAt',
]);

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseSortBy(value: string | null): ObjectSortField {
  return value && SORT_FIELDS.has(value as ObjectSortField)
    ? (value as ObjectSortField)
    : 'updatedAt';
}

export default function ObjectsPage(): React.JSX.Element {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = parsePage(searchParams.get('page'));
  const sortBy = parseSortBy(searchParams.get('sortBy'));
  const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';
  const [searchInput, setSearchInput] = useState(query);
  const [result, setResult] = useState<ObjectListPage>({
    items: [],
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const allowCreateObject = user?.capabilities?.canCreateObject ?? false;

  const replaceQuery = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  };

  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = searchInput.trim();

      if (nextQuery === query) return;

      const next = new URLSearchParams(searchParams.toString());
      if (nextQuery) next.set('q', nextQuery);
      else next.delete('q');
      next.delete('page');
      const serialized = next.toString();
      router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
        scroll: false,
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [pathname, query, router, searchInput, searchParams]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listObjectsPage({
          q: query || undefined,
          status: status || undefined,
          page,
          limit: PAGE_LIMIT,
          sortBy,
          sortDirection,
        });

        if (!cancelled) setResult(response);
      } catch {
        if (!cancelled) setError('Не удалось загрузить список объектов.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [page, query, sortBy, sortDirection, status]);

  const handleSort = (field: ObjectSortField): void => {
    const nextDirection =
      field === sortBy
        ? sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : field === 'name'
          ? 'asc'
          : 'desc';
    replaceQuery({
      sortBy: field,
      sortDirection: nextDirection,
      page: null,
    });
  };

  return (
    <div className="workspace-page object-registry">
      <PageTitle title="Объекты" />

      <section className="page-card workspace-surface section-header registry-header">
        <div>
          <div style={{ fontWeight: 700 }}>Реестр объектов</div>
          <div className="page-muted" style={{ marginTop: 4 }}>
            {query
              ? `Найдено объектов: ${result.total}`
              : `Всего доступно: ${result.total}`}
          </div>
        </div>

        {allowCreateObject ? (
          <Link className="button-link" href="/objects/new">
            Создать объект
          </Link>
        ) : null}
      </section>

      <div
        className="page-card workspace-surface filter-panel object-registry-filters"
      >
        <label>
          <div style={{ marginBottom: 6 }}>Поиск</div>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Название, адрес, ответственный или менеджер"
          />
        </label>

        <label>
          <div style={{ marginBottom: 6 }}>Статус</div>
          <select
            value={status}
            onChange={(event) =>
              replaceQuery({ status: event.target.value || null, page: null })
            }
          >
            <option value="">Все статусы</option>
            <option value="active">Активный</option>
            <option value="frozen">Заморожен</option>
            <option value="archived">Архив</option>
          </select>
        </label>
      </div>

      {isLoading ? (
        <div className="page-card workspace-surface workspace-empty" aria-live="polite">
          Загрузка списка объектов...
        </div>
      ) : error ? (
        <div className="page-card workspace-surface inline-notice inline-notice--warning">
          {error}
        </div>
      ) : (
        <>
          <ObjectListTable
            items={result.items}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSort={handleSort}
          />

          {result.totalPages > 1 ? (
            <div className="page-card workspace-surface object-registry-pagination">
              <span className="page-muted">
                Страница {result.page} из {result.totalPages}
              </span>
              <div className="action-row">
                <button
                  type="button"
                  disabled={result.page <= 1}
                  onClick={() =>
                    replaceQuery({ page: String(Math.max(1, result.page - 1)) })
                  }
                >
                  Назад
                </button>
                <button
                  type="button"
                  disabled={result.page >= result.totalPages}
                  onClick={() =>
                    replaceQuery({
                      page: String(Math.min(result.totalPages, result.page + 1)),
                    })
                  }
                >
                  Далее
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
