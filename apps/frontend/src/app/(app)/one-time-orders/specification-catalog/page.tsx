"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createSpecificationCatalogItem,
  createSpecificationTemplate,
  listSpecificationCatalog,
  listSpecificationTemplates,
  updateSpecificationCatalogItem,
  updateSpecificationTemplate,
} from "@/entities/one-time-order/api/one-time-order-client";
import type {
  SpecificationCatalogItem,
  SpecificationTemplate,
} from "@/entities/one-time-order/api/one-time-order-client";
import { ApiError } from "@/shared/api/fetcher";
import { useAuth } from "@/shared/auth/use-auth";
import { useAccessRevision } from "@/shared/auth/use-access-revision";
import { AccessSnapshotBoundary } from "@/shared/auth/access-snapshot-boundary";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  IconButton,
  LoadingState,
  Surface,
  Tooltip,
} from "@/shared/ui/foundation";
import { PencilIcon } from "@/shared/ui/icons/icons";
import { MediaActionIcon } from "@/shared/ui/app-shell/media-action-icon";
import { ConfirmDialog } from "@/shared/ui/overlays";
import { PageTitle } from "@/shared/ui/page-title/page-title";
import styles from "./specification-catalog.module.css";

export default function SpecificationCatalogPage(): React.JSX.Element {
  const { user } = useAuth();
  const accessRevision = useAccessRevision();
  const canRead = user?.capabilities?.canReadSpecificationCatalog ?? false;
  const canCreate = user?.capabilities?.canCreateSpecificationCatalog ?? false;
  const canUpdate = user?.capabilities?.canUpdateSpecificationCatalog ?? false;
  const canArchive = user?.capabilities?.canArchiveSpecificationCatalog ?? false;
  const [loadedRevision, setLoadedRevision] = useState<string | null>(null);
  const [items, setItems] = useState<SpecificationCatalogItem[]>([]);
  const [templates, setTemplates] = useState<SpecificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateNameConflict, setTemplateNameConflict] = useState(false);
  const [templateItemIds, setTemplateItemIds] = useState<string[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null,
  );
  const [editingTemplateVersion, setEditingTemplateVersion] = useState<
    number | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<
    | { kind: "item"; item: SpecificationCatalogItem }
    | { kind: "template"; item: SpecificationTemplate }
    | null
  >(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const itemInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const loadRequest = useRef(0);
  const mutationBusy = useRef(false);
  const latest = useRef({ canRead, canCreate, canUpdate, canArchive, accessRevision, loadedRevision, templates });
  latest.current = { canRead, canCreate, canUpdate, canArchive, accessRevision, loadedRevision, templates };
  type Mutation = "canCreate" | "canUpdate" | "canArchive";
  const canMutate = (permission: Mutation): boolean => {
    const current = latest.current;
    return current.canRead && current[permission] && current.loadedRevision === current.accessRevision;
  };

  const load = useCallback(async (): Promise<boolean> => {
    const revision = latest.current.accessRevision;
    if (!latest.current.canRead) return false;
    const requestId = ++loadRequest.current;
    const isCurrent = (): boolean => requestId === loadRequest.current &&
      latest.current.canRead && latest.current.accessRevision === revision;
    setLoading(true);
    setLoadedRevision(null);
    try {
      const [catalog, savedTemplates] = await Promise.all([
        listSpecificationCatalog(), listSpecificationTemplates(),
      ]);
      if (!isCurrent()) return false;
      setItems(catalog);
      setTemplates(savedTemplates);
      setLoadedRevision(revision);
      return true;
    } catch {
      if (isCurrent()) setError("Не удалось загрузить каталог ТЗ.");
      return false;
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setError(null);
    if (canRead) void load();
    else {
      loadRequest.current += 1;
      setLoadedRevision(null);
      setLoading(false);
    }
    return () => {
      loadRequest.current += 1;
    };
  }, [canRead, accessRevision, load]);

  const run = async (permission: Mutation, operation: () => Promise<unknown>): Promise<void> => {
    if (!canMutate(permission) || mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === "SPECIFICATION_TEMPLATE_NAME_CONFLICT"
      ) {
        setTemplateNameConflict(true);
      } else if (cause instanceof ApiError && cause.statusCode === 409) {
        await load();
        setError(
          "Шаблон уже изменён другим пользователем. Обновите каталог, отмените редактирование и откройте актуальный шаблон заново. Ваш текст пока сохранён в форме.",
        );
      } else
        setError(
          "Не удалось сохранить изменения. Проверьте данные и повторите попытку.",
        );
    } finally {
      mutationBusy.current = false;
      setBusy(false);
    }
  };

  return (
    <div className={`ui-page ${styles.page}`}>
      <PageTitle title="Каталог технических заданий" />
      {!canRead ? <Surface padding="md">У вас нет доступа к каталогу ТЗ.</Surface> : null}
      {canRead && error ? (
        <Alert
          tone="danger"
          role="alert"
          action={
            <Button
              disabled={busy || loading || !canRead}
              onClick={() => {
                setLoading(true);
                setError(null);
                void load();
              }}
            >
              Обновить каталог
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}
      {canRead && loading ? (
        <LoadingState label="Загрузка каталога…" />
      ) : null}
      <AccessSnapshotBoundary blocked={!canRead || loadedRevision !== accessRevision}>
        <div className={`ui-stack ${styles.columns}`}>
          <Surface as="section" padding="md" className="ui-stack ui-stack--lg">
            <div>
              <h2 className="ui-section-title">Пункты ТЗ</h2>
              <p className="ui-text-muted">
                Архивирование не меняет уже созданные заказы: их текстовые
                снимки сохраняются.
              </p>
            </div>
            <AccessSnapshotBoundary blocked={editingItemId ? !canUpdate : !canCreate}>
            <form
              className="ui-stack ui-stack--sm"
              onSubmit={(event) => {
                event.preventDefault();
                const permission = editingItemId ? "canUpdate" : "canCreate";
                if (!title.trim() || !canMutate(permission) || mutationBusy.current) return;
                const revision = latest.current.accessRevision;
                void run(permission, async () => {
                  if (editingItemId)
                    await updateSpecificationCatalogItem(editingItemId, {
                      title: title.trim(),
                    });
                  else
                    await createSpecificationCatalogItem({
                      title: title.trim(),
                    });
                  if (latest.current.accessRevision !== revision) return;
                  setTitle("");
                  setEditingItemId(null);
                });
              }}
            >
              <Field
                label={editingItemId ? "Изменить пункт" : "Новый пункт"}
                required
              >
                <input
                  ref={itemInputRef}
                  name="catalogItemTitle"
                  value={title}
                  disabled={busy}
                  maxLength={500}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </Field>
              <div className="ui-inline">
                <Button
                  variant="primary"
                  type="submit"
                  pending={busy}
                  pendingLabel="Сохраняем…"
                >
                  {editingItemId ? "Сохранить пункт" : "Добавить пункт"}
                </Button>
                {editingItemId ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingItemId(null);
                      setTitle("");
                    }}
                  >
                    Отмена
                  </Button>
                ) : null}
              </div>
            </form>
            </AccessSnapshotBoundary>
            {items.length === 0 ? (
              <EmptyState
                title="Пунктов нет"
                description={canCreate ? "Добавьте первый пункт в общий каталог." : undefined}
              />
            ) : (
              <ul className={styles.list}>
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={item.isArchived ? styles.archived : undefined}
                  >
                    <span className={styles.itemText}>
                      {item.title}
                      {item.isArchived ? <small> · В архиве</small> : null}
                    </span>
                    <div className={styles.rowActions}>
                      {canUpdate ? <Tooltip label="Изменить пункт">
                        <IconButton
                          aria-label={`Изменить пункт: ${item.title}`}
                          disabled={busy}
                          onClick={() => {
                            if (!canMutate("canUpdate") || mutationBusy.current) return;
                            setEditingItemId(item.id);
                            setTitle(item.title);
                            itemInputRef.current?.focus();
                          }}
                        >
                          <PencilIcon />
                        </IconButton>
                      </Tooltip> : null}
                      {canArchive ? <Tooltip
                        label={
                          item.isArchived
                            ? "Восстановить пункт"
                            : "Архивировать пункт"
                        }
                      >
                        <IconButton
                          aria-label={`${item.isArchived ? "Восстановить" : "Архивировать"} пункт: ${item.title}`}
                          disabled={busy}
                          onClick={() => {
                            if (!canMutate("canArchive") || mutationBusy.current) return;
                            setArchiveError(null);
                            setArchiveTarget({ kind: "item", item });
                          }}
                        >
                          <MediaActionIcon
                            name={item.isArchived ? "replace" : "archive"}
                          />
                        </IconButton>
                      </Tooltip> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <Surface as="section" padding="md" className="ui-stack ui-stack--lg">
            <div>
              <h2 className="ui-section-title">Шаблоны</h2>
              <p className="ui-text-muted">
                В заказ можно включить оба шаблона и дополнить их отдельными
                пунктами.
              </p>
            </div>
            <AccessSnapshotBoundary blocked={editingTemplateId ? !canUpdate : !canCreate}>
            <form
              className="ui-stack ui-stack--md"
              onSubmit={(event) => {
                event.preventDefault();
                const permission = editingTemplateId ? "canUpdate" : "canCreate";
                if (!templateName.trim() || !canMutate(permission) || mutationBusy.current) return;
                if (editingTemplateId && (editingTemplateVersion === null ||
                  latest.current.templates.find(({ id }) => id === editingTemplateId)?.version !== editingTemplateVersion)) {
                  setError("Шаблон уже изменён. Ваш черновик сохранён; отмените редактирование и откройте актуальную версию.");
                  return;
                }
                const revision = latest.current.accessRevision;
                setTemplateNameConflict(false);
                void run(permission, async () => {
                  const payload = {
                    name: templateName.trim(),
                    items: templateItemIds.map((catalogItemId, sortOrder) => ({
                      catalogItemId,
                      sortOrder,
                    })),
                  };
                  if (editingTemplateId && editingTemplateVersion !== null)
                    await updateSpecificationTemplate(editingTemplateId, {
                      ...payload,
                      expectedVersion: editingTemplateVersion,
                    });
                  else await createSpecificationTemplate(payload);
                  if (latest.current.accessRevision !== revision) return;
                  setEditingTemplateId(null);
                  setEditingTemplateVersion(null);
                  setTemplateName("");
                  setTemplateItemIds([]);
                });
              }}
            >
              <Field
                label={editingTemplateId ? "Название шаблона" : "Новый шаблон"}
                required
              >
                <input
                  ref={templateInputRef}
                  name="templateName"
                  value={templateName}
                  disabled={busy}
                  maxLength={120}
                  aria-invalid={templateNameConflict || undefined}
                  aria-describedby={templateNameConflict ? "template-name-conflict" : undefined}
                  onChange={(event) => {
                    setTemplateName(event.target.value);
                    setTemplateNameConflict(false);
                  }}
                  required
                />
              </Field>
              {templateNameConflict ? (
                <div id="template-name-conflict">
                  <Alert tone="danger" role="alert">
                    Шаблон с таким названием уже существует. Введите другое название.
                  </Alert>
                </div>
              ) : null}
              <div className={styles.templatePicker}>
                <strong>Пункты шаблона ({templateItemIds.length})</strong>
                {items
                  .filter((item) => !item.isArchived)
                  .map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={templateItemIds.includes(item.id)}
                        onChange={() =>
                          setTemplateItemIds((current) =>
                            current.includes(item.id)
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id],
                          )
                        }
                      />{" "}
                      {item.title}
                    </label>
                  ))}
              </div>
              <div className="ui-inline">
                <Button
                  variant="primary"
                  type="submit"
                  pending={busy}
                  pendingLabel="Сохраняем…"
                >
                  {editingTemplateId ? "Сохранить шаблон" : "Создать шаблон"}
                </Button>
                {editingTemplateId ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingTemplateId(null);
                      setEditingTemplateVersion(null);
                      setTemplateNameConflict(false);
                      setTemplateName("");
                      setTemplateItemIds([]);
                    }}
                  >
                    Отмена
                  </Button>
                ) : null}
              </div>
            </form>
            </AccessSnapshotBoundary>
            {templates.length === 0 ? (
              <EmptyState
                title="Шаблонов пока нет"
                description={canCreate ? "Выберите пункты и сохраните первый шаблон." : undefined}
              />
            ) : null}
            <ul className={styles.list}>
              {templates.map((template) => (
                <li
                  key={template.id}
                  className={template.isArchived ? styles.archived : undefined}
                >
                  <div className={styles.itemText}>
                    <strong>{template.name}</strong>
                    <small>
                      Пунктов: {template.items.length}
                      {template.isArchived ? " · В архиве" : ""}
                    </small>
                  </div>
                  <div className={styles.rowActions}>
                    {canUpdate ? <Tooltip label="Изменить шаблон">
                      <IconButton
                        aria-label={`Изменить шаблон: ${template.name}`}
                        disabled={busy}
                        onClick={() => {
                          if (!canMutate("canUpdate") || mutationBusy.current) return;
                          setEditingTemplateId(template.id);
                          setEditingTemplateVersion(template.version);
                          setTemplateNameConflict(false);
                          setTemplateName(template.name);
                          setTemplateItemIds(
                            template.items.map((item) => item.catalogItemId),
                          );
                          templateInputRef.current?.focus();
                        }}
                      >
                        <PencilIcon />
                      </IconButton>
                    </Tooltip> : null}
                    {canArchive ? <Tooltip
                      label={
                        template.isArchived
                          ? "Восстановить шаблон"
                          : "Архивировать шаблон"
                      }
                    >
                      <IconButton
                        aria-label={`${template.isArchived ? "Восстановить" : "Архивировать"} шаблон: ${template.name}`}
                        disabled={busy}
                        onClick={() => {
                          if (!canMutate("canArchive") || mutationBusy.current) return;
                          setArchiveError(null);
                          setArchiveTarget({
                            kind: "template",
                            item: template,
                          });
                        }}
                      >
                        <MediaActionIcon
                          name={template.isArchived ? "replace" : "archive"}
                        />
                      </IconButton>
                    </Tooltip> : null}
                  </div>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      <AccessSnapshotBoundary blocked={!canArchive}>
      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setArchiveTarget(null);
        }}
        title={
          archiveTarget?.item.isArchived
            ? "Восстановить в каталоге?"
            : "Архивировать в каталоге?"
        }
        consequence={
          archiveTarget ? (
            <p>
              «
              {archiveTarget.kind === "item"
                ? archiveTarget.item.title
                : archiveTarget.item.name}
              »
              {archiveTarget.item.isArchived
                ? " снова появится в выборе для новых заказов."
                : " больше не будет доступен для нового выбора."}{" "}
              ТЗ уже созданных заказов сохранится без изменений.
            </p>
          ) : null
        }
        confirmLabel={
          archiveTarget?.item.isArchived ? "Восстановить" : "Архивировать"
        }
        pending={busy}
        error={archiveError}
        onConfirm={() => {
          if (!archiveTarget || !canMutate("canArchive") || mutationBusy.current) return;
          const target = archiveTarget;
          if (target.kind === "template" &&
            latest.current.templates.find(({ id }) => id === target.item.id)?.version !== target.item.version) {
            setArchiveError("Шаблон уже изменён. Закройте окно, обновите каталог и повторите действие.");
            return;
          }
          const revision = latest.current.accessRevision;
          mutationBusy.current = true;
          setBusy(true);
          setArchiveError(null);
          void (async () => {
            try {
              if (target.kind === "item") {
                await updateSpecificationCatalogItem(target.item.id, {
                  isArchived: !target.item.isArchived,
                });
              } else {
                await updateSpecificationTemplate(target.item.id, {
                  expectedVersion: target.item.version,
                  isArchived: !target.item.isArchived,
                });
              }
              await load();
              if (latest.current.accessRevision === revision) setArchiveTarget(null);
            } catch (cause) {
              setArchiveError(
                cause instanceof ApiError && cause.statusCode === 409
                  ? "Шаблон уже изменён. Закройте окно, обновите каталог и повторите действие."
                  : "Не удалось сохранить. Повторите попытку.",
              );
            } finally {
              mutationBusy.current = false;
              setBusy(false);
            }
          })();
        }}
      />
      </AccessSnapshotBoundary>
      </AccessSnapshotBoundary>
    </div>
  );
}
