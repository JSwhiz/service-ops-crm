"use client";
import React, { useCallback, useEffect, useState } from "react";
import {
  getOrderEscorts,
  saveOrderEscorts,
  type OrderEscorts,
} from "@/entities/one-time-order/api/one-time-order-operations-client";
import type { OneTimeWorkforceEmployee } from "@/entities/one-time-order/api/one-time-order-workforce-client";
import {
  Alert,
  Button,
  Field,
  LoadingState,
  Stack,
  Surface,
} from "@/shared/ui/foundation";
import { DatePicker } from "@/shared/ui/date-picker/date-picker";

export function OneTimeOrderEscortsPanel({
  orderId,
  workforce,
  onChanged,
}: {
  orderId: string;
  workforce: OneTimeWorkforceEmployee[];
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(
      new Date(),
    ),
  );
  const [data, setData] = useState<OrderEscorts | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const apply = (value: OrderEscorts) => {
    setData(value);
    setSelected(
      value.items
        .find((row) => row.escort.id === value.currentUserId)
        ?.employees.map((row) => row.employeeId) ?? [],
    );
  };
  const reload = useCallback(async () => {
    apply(await getOrderEscorts(orderId, date));
  }, [orderId, date]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setError(null);
    void getOrderEscorts(orderId, date)
      .then((value) => {
        if (active) apply(value);
      })
      .catch(() => {
        if (active) setError("Не удалось загрузить сопровождающих.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId, date]);
  const own = data?.items.find((row) => row.escort.id === data.currentUserId);
  return (
    <Surface padding="md">
      <Stack gap="md">
        <h2 className="ui-section-title">Кто едет на заказ</h2>
        <Field label="Дата поездки">
          <DatePicker value={date} disabled={pending} onChange={setDate} />
        </Field>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        {loading ? (
          <LoadingState />
        ) : data ? (
          <>
            {data.items.length ? (
              data.items.map((list) => (
                <div key={list.id}>
                  <strong>{list.escort.fullName}</strong>
                  <ul>
                    {list.employees.map((row) => (
                      <li key={row.employeeId}>{row.employee.fullName}</li>
                    ))}
                  </ul>
                  <div className="ui-text-muted">
                    Изменил: {list.updatedBy.fullName} ·{" "}
                    {new Date(list.updatedAt).toLocaleString("ru-RU", {
                      timeZone: "Europe/Moscow",
                    })}{" "}
                    МСК
                  </div>
                </div>
              ))
            ) : (
              <div className="ui-text-muted">
                Список на эту дату не заполнен.
              </div>
            )}
            {data.canManageOwn ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pending) return;
                  setPending(true);
                  setError(null);
                  void saveOrderEscorts(orderId, {
                    operationDate: date,
                    expectedVersion: own?.version ?? 0,
                    employeeIds: selected,
                  })
                    .then(async () => {
                      await reload();
                      await onChanged();
                    })
                    .catch(() =>
                      setError(
                        "Не удалось сохранить список. При конфликте обновите данные; выбранные сотрудники сохранены в форме.",
                      ),
                    )
                    .finally(() => setPending(false));
                }}
              >
                <Stack gap="md">
                  <fieldset disabled={pending}>
                    <legend>
                      Мои сопровождающие — выберите хотя бы одного сотрудника
                    </legend>
                    {workforce
                      .filter((row) => row.isActive)
                      .map((employee) => (
                        <label key={employee.employeeId} className="ui-inline">
                          <input
                            type="checkbox"
                            checked={selected.includes(employee.employeeId)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, employee.employeeId]
                                  : current.filter(
                                      (id) => id !== employee.employeeId,
                                    ),
                              )
                            }
                          />
                          {employee.fullName}
                        </label>
                      ))}
                  </fieldset>
                  <Button type="submit" disabled={pending || !selected.length}>
                    Сохранить мой список
                  </Button>
                </Stack>
              </form>
            ) : null}
          </>
        ) : null}
        <Button
          disabled={pending || loading}
          onClick={() => {
            setError(null);
            void reload().catch(() => setError("Не удалось обновить список."));
          }}
        >
          Обновить список
        </Button>
      </Stack>
    </Surface>
  );
}
