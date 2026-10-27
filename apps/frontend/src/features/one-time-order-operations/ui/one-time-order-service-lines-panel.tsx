"use client";
import React, { useCallback, useEffect, useState } from "react";
import {
  getOrderServiceLines,
  saveOrderServiceLines,
  type OrderServiceLines,
} from "@/entities/one-time-order/api/one-time-order-operations-client";
import {
  Alert,
  Button,
  Field,
  LoadingState,
  Stack,
  Surface,
} from "@/shared/ui/foundation";

export function OneTimeOrderServiceLinesPanel({
  orderId,
  onChanged,
}: {
  orderId: string;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [data, setData] = useState<OrderServiceLines | null>(null);
  const [cleaning, setCleaning] = useState("");
  const [drycleaning, setDrycleaning] = useState("");
  const [total, setTotal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const apply = (value: OrderServiceLines) => {
    setData(value);
    setTotal(value.agreedSum === null ? '' : String(value.agreedSum));
    setCleaning(
      String(
        value.lines.find((row) => row.serviceCode === "cleaning")?.amount ?? "",
      ),
    );
    setDrycleaning(
      String(
        value.lines.find((row) => row.serviceCode === "drycleaning")?.amount ??
          "",
      ),
    );
  };
  const load = useCallback(async () => {
    apply(await getOrderServiceLines(orderId));
  }, [orderId]);
  useEffect(() => {
    let active = true;
    void getOrderServiceLines(orderId)
      .then((value) => {
        if (active) apply(value);
      })
      .catch(() => {
        if (active) setError("Не удалось загрузить составляющие заказа.");
      });
    return () => {
      active = false;
    };
  }, [orderId]);
  const money = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;
  const valid =
    cleaning !== "" &&
    drycleaning !== "" &&
    total !== '' &&
    [Number(cleaning), Number(drycleaning), Number(total)].every(
      (value) => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647,
    ) &&
    Number(cleaning) + Number(drycleaning) === Number(total);
  return (
    <Surface padding="md">
      <Stack gap="md">
        <h2 className="ui-section-title">Уборка и химчистка</h2>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        {data ? (
          <>
            <div>
              Сумма заказа:{" "}
              {data.agreedSum === null ? "Не указана" : money(data.agreedSum)}
            </div>
            {data.lines.length ? (
              <ul>
                {data.lines.map((line) => (
                  <li key={line.id}>
                    {line.serviceCode === "cleaning" ? "Уборка" : "Химчистка"}:{" "}
                    {money(line.amount)}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ui-text-muted">Составляющие не указаны.</div>
            )}
            {data.lines.length ? (
              <div>
                {data.isReconciled
                  ? "Итог сверён с суммой заказа"
                  : "Итог не совпадает с суммой заказа"}
              </div>
            ) : null}
            {data.canEdit ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pending || !valid) return;
                  setPending(true);
                  setError(null);
                  void saveOrderServiceLines(orderId, {
                    expectedVersion: data.version,
                    agreedSum: Number(total),
                    lines: [
                      { serviceCode: "cleaning", amount: Number(cleaning) },
                      {
                        serviceCode: "drycleaning",
                        amount: Number(drycleaning),
                      },
                    ],
                  })
                    .then(async (value) => {
                      apply(value);
                      await onChanged();
                    })
                    .catch(() =>
                      setError(
                        "Не удалось сохранить составляющие. Проверьте суммы или обновите данные при конфликте.",
                      ),
                    )
                    .finally(() => setPending(false));
                }}
              >
                <Stack gap="md">
                  <div className="field-grid">
                    <Field label="Итог заказа, ₽" required>
                      <input type="number" min="0" step="1" required value={total} disabled={pending} onChange={(event) => setTotal(event.target.value)} />
                    </Field>
                    <Field label="Уборка, ₽" required>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={cleaning}
                        disabled={pending}
                        onChange={(event) => setCleaning(event.target.value)}
                      />
                    </Field>
                    <Field label="Химчистка, ₽" required>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required
                        value={drycleaning}
                        disabled={pending}
                        onChange={(event) => setDrycleaning(event.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="ui-text-muted">
                    Укажите обе суммы явно. Их сумма должна совпадать с итогом
                    заказа.
                  </div>
                  <Button type="submit" disabled={pending || !valid}>
                    Сохранить составляющие
                  </Button>
                </Stack>
              </form>
            ) : null}
          </>
        ) : !error ? (
          <LoadingState />
        ) : null}
        <Button
          disabled={pending}
          onClick={() => {
            setError(null);
            void load().catch(() =>
              setError("Не удалось обновить составляющие."),
            );
          }}
        >
          Обновить данные
        </Button>
      </Stack>
    </Surface>
  );
}
