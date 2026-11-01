"use client";

import React, { useEffect, useRef, useState } from "react";
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
import { isLeadershipCircle } from "@/shared/lib/access";
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
  const allowed = isLeadershipCircle(user?.roleCodes ?? []);
  const [items, setItems] = useState<SpecificationCatalogItem[]>([]);
  const [templates, setTemplates] = useState<SpecificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
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

  const load = async (): Promise<void> => {
    const [catalog, savedTemplates] = await Promise.all([
      listSpecificationCatalog(),
      listSpecificationTemplates(),
    ]);
    setItems(catalog);
    setTemplates(savedTemplates);
  };
  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let active = true;
    Promise.all([listSpecificationCatalog(), listSpecificationTemplates()])
      .then(([catalog, savedTemplates]) => {
        if (active) {
          setItems(catalog);
          setTemplates(savedTemplates);
        }
      })
      .catch(() => {
        if (active) setError("Не удалось загрузить каталог ТЗ.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [allowed]);

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.statusCode === 409) {
        try {
          await load();
        } catch {
          /* Keep the concurrency message visible even if refresh fails. */
        }
        setError(
          "Шаблон уже изменён другим пользователем. Каталог обновлён; отмените редактирование и откройте актуальный шаблон заново. Ваш текст пока сохранён в форме.",
        );
      } else
        setError(
          "Не удалось сохранить изменения. Проверьте данные и повторите попытку.",
        );
    } finally {
      setBusy(false);
    }
  };

  if (!allowed)
    return (
      <div className="ui-page">
        <PageTitle title="Каталог технических заданий" />
        <Surface padding="md">Доступ есть только у руководящего круга.</Surface>
      </div>
    );

  return (
    <div className={`ui-page ${styles.page}`}>
      <PageTitle title="Каталог технических заданий" />
      {error ? (
        <Alert
          tone="danger"
          role="alert"
          action={
            <Button
              disabled={busy}
              onClick={() => {
                setLoading(true);
                setError(null);
                void load()
                  .catch(() =>
                    setError("Не удалось обновить каталог. Повторите попытку."),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Обновить каталог
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <LoadingState label="Загрузка каталога…" />
      ) : (
        <div className={`ui-stack ${styles.columns}`}>
          <Surface as="section" padding="md" className="ui-stack ui-stack--lg">
            <div>
              <h2 className="ui-section-title">Пункты ТЗ</h2>
              <p className="ui-text-muted">
                Архивирование не меняет уже созданные заказы: их текстовые
                снимки сохраняются.
              </p>
            </div>
            <form
              className="ui-stack ui-stack--sm"
              onSubmit={(event) => {
                event.preventDefault();
                if (!title.trim() || busy) return;
                void run(async () => {
                  if (editingItemId)
                    await updateSpecificationCatalogItem(editingItemId, {
                      title: title.trim(),
                    });
                  else
                    await createSpecificationCatalogItem({
                      title: title.trim(),
                    });
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
            {items.length === 0 ? (
              <EmptyState
                title="Пунктов нет"
                description="Добавьте первый пункт в общий каталог."
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
                      <Tooltip label="Изменить пункт">
                        <IconButton
                          aria-label={`Изменить пункт: ${item.title}`}
                          disabled={busy}
                          onClick={() => {
                            setEditingItemId(item.id);
                            setTitle(item.title);
                            itemInputRef.current?.focus();
                          }}
                        >
                          <PencilIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip
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
                            setArchiveError(null);
                            setArchiveTarget({ kind: "item", item });
                          }}
                        >
                          <MediaActionIcon
                            name={item.isArchived ? "replace" : "archive"}
                          />
                        </IconButton>
                      </Tooltip>
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
            <form
              className="ui-stack ui-stack--md"
              onSubmit={(event) => {
                event.preventDefault();
                if (!templateName.trim() || busy) return;
                void run(async () => {
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
                  onChange={(event) => setTemplateName(event.target.value)}
                  required
                />
              </Field>
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
                      setTemplateName("");
                      setTemplateItemIds([]);
                    }}
                  >
                    Отмена
                  </Button>
                ) : null}
              </div>
            </form>
            {templates.length === 0 ? (
              <EmptyState
                title="Шаблонов пока нет"
                description="Выберите пункты и сохраните первый шаблон."
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
                    <Tooltip label="Изменить шаблон">
                      <IconButton
                        aria-label={`Изменить шаблон: ${template.name}`}
                        disabled={busy}
                        onClick={() => {
                          setEditingTemplateId(template.id);
                          setEditingTemplateVersion(template.version);
                          setTemplateName(template.name);
                          setTemplateItemIds(
                            template.items.map((item) => item.catalogItemId),
                          );
                          templateInputRef.current?.focus();
                        }}
                      >
                        <PencilIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip
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
                    </Tooltip>
                  </div>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      )}
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
          if (!archiveTarget || busy) return;
          const target = archiveTarget;
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
              setArchiveTarget(null);
            } catch (cause) {
              setArchiveError(
                cause instanceof ApiError && cause.statusCode === 409
                  ? "Шаблон уже изменён. Закройте окно, обновите каталог и повторите действие."
                  : "Не удалось сохранить. Повторите попытку.",
              );
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
    </div>
  );
}
