"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  listSpecificationCatalog,
  listSpecificationTemplates,
} from "@/entities/one-time-order/api/one-time-order-client";
import type {
  SpecificationCatalogItem,
  SpecificationTemplate,
} from "@/entities/one-time-order/api/one-time-order-client";
import { Alert, Button, Field } from "@/shared/ui/foundation";

export interface SpecificationDraft {
  catalogItemIds: string[];
  templateIds: string[];
  customItems: Array<{
    title: string;
    description?: string | null;
    requiresAttachment?: boolean;
  }>;
}

export function SpecificationComposer({
  value,
  onChange,
}: {
  value: SpecificationDraft;
  onChange: (next: SpecificationDraft) => void;
}): React.JSX.Element {
  const [items, setItems] = useState<SpecificationCatalogItem[]>([]);
  const [templates, setTemplates] = useState<SpecificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listSpecificationCatalog(), listSpecificationTemplates()])
      .then(([catalog, templateList]) => {
        if (!active) return;
        setItems(catalog.filter((item) => !item.isArchived));
        setTemplates(templateList.filter((template) => !template.isArchived));
      })
      .catch(() => {
        if (active)
          setError(
            "Не удалось загрузить каталог ТЗ. Обновите страницу или проверьте доступ.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedTemplateItemIds = useMemo(
    () =>
      new Set(
        templates
          .filter((template) => value.templateIds.includes(template.id))
          .flatMap((template) =>
            template.items.map((item) => item.catalogItemId),
          ),
      ),
    [templates, value.templateIds],
  );
  const toggle = (current: string[], id: string): string[] =>
    current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
  const toggleTemplate = (templateId: string): void => {
    const templateIds = toggle(value.templateIds, templateId);
    const includedIds = new Set(
      templates
        .filter((template) => templateIds.includes(template.id))
        .flatMap((template) => template.items.map((item) => item.catalogItemId)),
    );
    onChange({
      ...value,
      templateIds,
      catalogItemIds: value.catalogItemIds.filter((id) => !includedIds.has(id)),
    });
  };
  const selectedCount = value.catalogItemIds.length;

  return (
    <section
      className="ui-stack ui-stack--md"
      aria-labelledby="spec-composer-heading"
    >
      <div>
        <h3 className="ui-section-title" id="spec-composer-heading">
          Техническое задание
        </h3>
        <p className="ui-text-muted">
          Выберите один или оба шаблона, затем при необходимости уточните состав
          пунктами из каталога. Формулировки исходных пунктов сохраняются в
          заказе.
        </p>
      </div>
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <p role="status" className="ui-text-muted">
          Загружаем шаблоны и пункты…
        </p>
      ) : null}
      {!loading && !error ? (
        <>
          <div className="ui-stack ui-stack--sm">
            <strong>Готовые шаблоны</strong>
            {templates.length ? (
              templates.map((template) => (
                <label className="ui-inline" key={template.id}>
                  <input
                    type="checkbox"
                    checked={value.templateIds.includes(template.id)}
            onChange={() => toggleTemplate(template.id)}
                  />
                  <span>
                    <strong>{template.name}</strong>
                    <span className="ui-text-muted">
                      {" "}
                      · {template.items.length} пунктов
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <p className="ui-text-muted">Активных шаблонов пока нет.</p>
            )}
          </div>
          <details>
            <summary>Выбрать отдельные пункты ({selectedCount})</summary>
            <div className="ui-stack ui-stack--sm">
              {items.map((item) => {
                const isInSelectedTemplate = selectedTemplateItemIds.has(
                  item.id,
                );
                return (
                  <label className="ui-inline" key={item.id}>
                    <input
                      type="checkbox"
                      checked={
                        isInSelectedTemplate ||
                        value.catalogItemIds.includes(item.id)
                      }
                      disabled={isInSelectedTemplate}
                      aria-label={
                        isInSelectedTemplate
                          ? `${item.title} — уже входит в выбранный шаблон`
                          : item.title
                      }
                      onChange={() =>
                        onChange({
                          ...value,
                          catalogItemIds: toggle(value.catalogItemIds, item.id),
                        })
                      }
                    />
                    <span>
                      {item.title}
                      {item.description ? (
                        <span className="ui-text-muted">
                          {" "}
                          — {item.description}
                        </span>
                      ) : null}
                      {isInSelectedTemplate ? (
                        <span className="ui-text-muted">
                          {" "}
                          · уже в выбранном шаблоне
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
          <div className="ui-stack ui-stack--sm">
            <div className="ui-section-header">
              <strong>Дополнительные пункты</strong>
              <Button
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    customItems: [
                      ...value.customItems,
                      {
                        title: "",
                        description: null,
                        requiresAttachment: false,
                      },
                    ],
                  })
                }
              >
                Добавить пункт
              </Button>
            </div>
            {value.customItems.map((item, index) => (
              <div className="ui-stack ui-stack--sm" key={index}>
                <Field label={`Дополнительный пункт ${index + 1}`} required>
                  <input
                    maxLength={500}
                    value={item.title}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        customItems: value.customItems.map(
                          (entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, title: event.target.value }
                              : entry,
                        ),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      customItems: value.customItems.filter(
                        (_entry, entryIndex) => entryIndex !== index,
                      ),
                    })
                  }
                >
                  Убрать пункт
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
