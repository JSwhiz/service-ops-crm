"use client";
import React, { useEffect, useState } from "react";
import {
  getOrderDeadline,
  saveOrderDeadline,
  type OrderDeadline,
} from "@/entities/one-time-order/api/one-time-order-operations-client";
import { Alert, Button, Field, LoadingState, Stack, Surface } from "@/shared/ui/foundation";
import { DatePicker } from "@/shared/ui/date-picker/date-picker";
import styles from "./one-time-order-deadline-panel.module.css";

const moscowInput = (timestamp: string | null) =>
  timestamp
    ? new Date(new Date(timestamp).getTime() + 3 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 16)
    : "";
export function OneTimeOrderDeadlinePanel({
  orderId,
  onChanged,
}: {
  orderId: string;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [data, setData] = useState<OrderDeadline | null>(null);
  const [deadline, setDeadline] = useState("");
  const [pending, setPending] = useState(false);
  const [isReading, setIsReading] = useState(true);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = (value: OrderDeadline) => {
    setData(value);
    setDeadline(moscowInput(value.deadlineAt));
  };
  useEffect(() => {
    let active = true;
    setData(null);
    setDeadline("");
    setError(null);
    setIsReading(true);
    setNeedsRefresh(false);
    setRefreshed(false);
    void getOrderDeadline(orderId)
      .then((value) => {
        if (active) apply(value);
      })
      .catch(() => {
        if (active) {
          setError("Не удалось загрузить срок заказа.");
          setNeedsRefresh(true);
        }
      })
      .finally(() => {
        if (active) setIsReading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);
  return (
    <Surface as="section" padding="md">
      <Stack gap="md">
        <h2 className="ui-section-title">Срок завершения заказа</h2>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        {isReading && !data ? <LoadingState label="Загрузка срока…" /> : null}
        {data && !data.canEdit ? <div>
          {data.deadlineAt
            ? `${new Date(data.deadlineAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`
            : "Срок не задан"}
        </div> : null}
        {refreshed && data?.canEdit ? (
          <Alert tone="info" role="status">
            Данные обновлены, введённая дата не сброшена. Проверьте её перед сохранением.
            {" "}Текущий срок заказа: {data.deadlineAt
              ? `${new Date(data.deadlineAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`
              : "не задан"}.
          </Alert>
        ) : null}
        {data?.canEdit ? (
          <form
            className={styles.form}
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || isReading || needsRefresh) return;
              setPending(true);
              setError(null);
              setRefreshed(false);
              try {
                const value = await saveOrderDeadline(orderId, {
                  expectedUpdatedAt: data.updatedAt,
                  deadlineAt: deadline
                    ? new Date(`${deadline}:00+03:00`).toISOString()
                    : null,
                });
                apply(value);
                try {
                  await onChanged();
                } catch {
                  setError("Срок сохранён, но не удалось обновить остальные данные карточки.");
                }
              } catch {
                setError("Не удалось подтвердить сохранение срока. Загрузите актуальные данные перед повторным сохранением. Введённая дата останется в форме.");
                setNeedsRefresh(true);
              } finally {
                setPending(false);
              }
            }}
          >
            <Field label="Дата и время, МСК" className={styles.field}>
              <DatePicker
                withTime
                clearable
                displayFormat="short"
                placeholder="Срок не задан"
                value={deadline}
                onChange={setDeadline}
                disabled={pending || isReading}
              />
            </Field>
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Сохраняем…" disabled={isReading || needsRefresh}>
              Сохранить срок
            </Button>
          </form>
        ) : null}
        {needsRefresh ? <div className="ui-inline"><Button
          variant="ghost"
          pending={isReading}
          pendingLabel="Загружаем…"
          disabled={pending}
          onClick={async () => {
            if (pending || isReading) return;
            setIsReading(true);
            setError(null);
            try {
              const value = await getOrderDeadline(orderId);
              if (data) {
                setData(value);
                setRefreshed(true);
              } else {
                apply(value);
              }
              setNeedsRefresh(false);
            } catch {
              setError("Не удалось загрузить актуальный срок. Введённая дата сохранена в форме.");
            } finally {
              setIsReading(false);
            }
          }}
        >
          Загрузить актуальные данные
        </Button></div> : null}
      </Stack>
    </Surface>
  );
}
