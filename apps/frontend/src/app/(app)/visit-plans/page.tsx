"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  addVisitPlanEntry,
  createVisitPlan,
  getPlanHistory,
  getPlanManagers,
  getVisitPlan,
  recordPlanVisit,
  savePlanReport,
  type PlanHistory,
  type VisitPlan,
  type VisitPlanDay,
} from "@/entities/visit-plan/api/visit-plan-client";
import { listObjectsPage } from "@/entities/object/api/object-client";
import { ApiError } from "@/shared/api/fetcher";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  LoadingState,
  PageHeader,
  Stack,
  Surface,
} from "@/shared/ui/foundation";
import { DatePicker } from "@/shared/ui/date-picker/date-picker";
import { Select } from "@/shared/ui/searchable-select/select";
import { SearchableSelect } from "@/shared/ui/searchable-select/searchable-select";
import styles from "./visit-plans.module.css";

const historyLabels: Record<string, string> = {
  "visit_plan.created": "План создан",
  "visit_plan.entry_added": "Добавлен визит",
  "visit_plan.unplanned_added": "Добавлен внеплановый визит",
  "visit_plan.visit_recorded": "Обновлена отметка посещения",
  "visit_plan.report_saved": "Обновлён дневной отчёт",
};
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(
    new Date(),
  );
const mutationError = (error: unknown) =>
  error instanceof ApiError && error.statusCode === 409
    ? "План изменился. Обновите данные перед сохранением; введённый текст сохранён в форме."
    : "Не удалось сохранить план. Проверьте данные и права доступа.";

export default function VisitPlansPage(): React.JSX.Element {
  const [date, setDate] = useState(today);
  const [managerId, setManagerId] = useState("");
  const [data, setData] = useState<VisitPlanDay | null>(null);
  const [managers, setManagers] = useState<
    Array<{ id: string; fullName: string }>
  >([]);
  const [history, setHistory] = useState<PlanHistory[]>([]);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [managersLoadFailed, setManagersLoadFailed] = useState(false);
  const [report, setReport] = useState("");
  const [reportDirty, setReportDirty] = useState(false);
  const [clientName, setClientName] = useState("");
  const [objectId, setObjectId] = useState("");
  const [entryType, setEntryType] = useState("client");
  const [isUnplanned, setIsUnplanned] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(window.location.search);
      setDate(params.get("date") ?? today());
      setManagerId(params.get("managerUserId") ?? "");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const day = await getVisitPlan(date, managerId || undefined);
      if (sequence !== request.current) return;
      setData(day);
      if (!reportDirty) setReport(day.plan?.report ?? "");
      const [historyResult, managersResult] = await Promise.allSettled([
        day.plan ? getPlanHistory(day.plan.id) : Promise.resolve([]),
        day.capabilities.canManage ? getPlanManagers() : Promise.resolve([]),
      ]);
      if (sequence !== request.current) return;
      setHistory(
        historyResult.status === "fulfilled" ? historyResult.value : [],
      );
      setManagers(
        managersResult.status === "fulfilled" ? managersResult.value : [],
      );
      setHistoryLoadFailed(historyResult.status === "rejected");
      setManagersLoadFailed(managersResult.status === "rejected");
      if (
        historyResult.status === "rejected" ||
        managersResult.status === "rejected"
      )
        setError("Часть данных не загрузилась. Обновите данные.");
    } catch {
      if (sequence === request.current) {
        setData(null);
        setError(
          "Не удалось загрузить план. Проверьте дату и доступ к выбранному менеджеру.",
        );
      }
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, [date, managerId, reportDirty]);
  // Changing a text draft must not trigger a refetch.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void loadRef.current();
    return () => {
      request.current += 1;
    };
  }, [date, managerId]);

  const select = (nextDate: string, nextManager: string) => {
    setReportDirty(false);
    setReport("");
    setData(null);
    setHistory([]);
    setDate(nextDate);
    setManagerId(nextManager);
    const url = new URL(window.location.href);
    url.searchParams.set("date", nextDate);
    if (nextManager) url.searchParams.set("managerUserId", nextManager);
    else url.searchParams.delete("managerUserId");
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  };

  const mutate = async (action: () => Promise<VisitPlan>) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const plan = await action();
      setData((current) => (current ? { ...current, plan } : current));
      setHistory(await getPlanHistory(plan.id));
    } catch (failure) {
      setError(mutationError(failure));
    } finally {
      setPending(false);
    }
  };
  const plan = data?.plan;
  return (
    <div className={`ui-page ${styles.page}`}>
      <PageHeader title="План посещений на день" />
      <Stack gap="lg">
        <Surface padding="md" className={styles.formPanel}>
          <div className={styles.fields}>
            <Field label="Дата">
              <DatePicker
                value={date}
                disabled={pending || reportDirty}
                onChange={(value) => select(value, managerId)}
              />
            </Field>
            {data?.capabilities.canManage ? (
              <Field label="Менеджер" error={managersLoadFailed ? "Список менеджеров не загружен. Обновите данные." : undefined}>
                <Select
                  value={managerId}
                  disabled={pending || reportDirty}
                  onChange={(event) => select(date, event.target.value)}
                >
                  <option value="">Мой план</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {reportDirty ? (
            <div className="ui-text-muted">
              Сохраните отчёт или отмените изменения перед сменой дня.
            </div>
          ) : null}
        </Surface>
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : null}
        <Button disabled={pending} onClick={() => void load()}>
          Обновить данные
        </Button>
        {loading ? (
          <LoadingState label="Загрузка плана" />
        ) : plan ? (
          <>
            <Surface padding="md">
              <h2 className="ui-section-title">{plan.manager.fullName}</h2>
              <div className="ui-text-muted">
                Создал: {plan.createdBy.fullName} · Посещено{" "}
                {plan.entries.filter((entry) => entry.visitedAt).length} из{" "}
                {plan.entries.length}
              </div>
              {plan.reportDueAt ? (
                <div>
                  Срок отчёта:{" "}
                  {new Date(plan.reportDueAt).toLocaleString("ru-RU", {
                    timeZone: "Europe/Moscow",
                  })}{" "}
                  МСК
                </div>
              ) : null}
              <div>
                {plan.reportClosedAt ? "Отчёт закрыт" : "Отчёт не закрыт"}
              </div>
            </Surface>
            {plan.entries.map((entry) => (
              <VisitEntry
                key={entry.id}
                entry={entry}
                canManage={data.capabilities.canManage}
                disabled={pending}
                onSave={(visited, visitReport) =>
                  mutate(() =>
                    recordPlanVisit(plan.id, entry.id, {
                      expectedVersion: plan.version,
                      visited,
                      visitReport,
                    }),
                  )
                }
              />
            ))}
            {!plan.entries.length ? (
              <EmptyState title="Визитов пока нет" />
            ) : null}
            {data.capabilities.canManage ? (
              <Surface padding="md" className={styles.formPanel}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate(() =>
                      addVisitPlanEntry(plan.id, {
                        expectedVersion: plan.version,
                        ...(entryType === "object"
                          ? { objectId }
                          : { clientName }),
                        isUnplanned,
                      }),
                    );
                  }}
                >
                  <Stack gap="md">
                    <h2 className="ui-section-title">Добавить визит</h2>
                    <Field label="Куда">
                      <Select
                        value={entryType}
                        disabled={pending}
                        onChange={(event) => setEntryType(event.target.value)}
                      >
                        <option value="client">Клиент</option>
                        <option value="object">Объект</option>
                      </Select>
                    </Field>
                    {entryType === "client" ? (
                      <Field label="Клиент" required>
                        <input
                          required
                          maxLength={500}
                          value={clientName}
                          disabled={pending}
                          onChange={(event) =>
                            setClientName(event.target.value)
                          }
                        />
                      </Field>
                    ) : (
                      <SearchableSelect
                        label="Объект"
                        value={objectId}
                        disabled={pending}
                        onChange={setObjectId}
                      options={[]}
                      asyncSearch={async (q) =>
                          (
                            await listObjectsPage({
                              q,
                              page: 1,
                              limit: 20,
                              sortBy: "name",
                              sortDirection: "asc",
                            })
                          ).items.map((object) => ({
                            value: object.id,
                            label: object.name,
                          }))
                        }
                      />
                    )}
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={isUnplanned}
                        disabled={pending}
                        onChange={(event) =>
                          setIsUnplanned(event.target.checked)
                        }
                      />{" "}
                      Внеплановый визит
                    </label>
                    <Button
                      type="submit"
                      disabled={
                        pending ||
                        (entryType === "object"
                          ? !objectId
                          : !clientName.trim())
                      }
                    >
                      Добавить визит
                    </Button>
                  </Stack>
                </form>
              </Surface>
            ) : null}
            <Surface padding="md">
              <h2 className="ui-section-title">Дневной отчёт</h2>
              {data.capabilities.canManage ? (
                <Stack gap="md">
                  <Field label="Текст отчёта">
                    <textarea
                      rows={5}
                      maxLength={20000}
                      value={report}
                      disabled={pending}
                      onChange={(event) => {
                        setReport(event.target.value);
                        setReportDirty(true);
                      }}
                    />
                  </Field>
                  <div className="ui-inline">
                    <Button
                      disabled={pending}
                      onClick={() =>
                        void mutate(async () => {
                          const saved = await savePlanReport(plan.id, {
                            expectedVersion: plan.version,
                            report,
                            closeReport: false,
                          });
                          setReportDirty(false);
                          return saved;
                        })
                      }
                    >
                      Сохранить отчёт
                    </Button>
                    <Button
                      disabled={pending || !report.trim()}
                      onClick={() =>
                        void mutate(async () => {
                          const saved = await savePlanReport(plan.id, {
                            expectedVersion: plan.version,
                            report,
                            closeReport: true,
                          });
                          setReportDirty(false);
                          return saved;
                        })
                      }
                    >
                      Закрыть отчёт
                    </Button>
                    {reportDirty ? (
                      <Button
                        disabled={pending}
                        onClick={() => {
                          setReport(plan.report ?? "");
                          setReportDirty(false);
                        }}
                      >
                        Отменить изменения
                      </Button>
                    ) : null}
                  </div>
                </Stack>
              ) : (
                <p className={styles.report}>{plan.report ?? "Отчёт пока не заполнен."}</p>
              )}
            </Surface>
            <Surface padding="md">
              <h2 className="ui-section-title">История</h2>
              {historyLoadFailed ? <p className="ui-text-muted">История не загружена. Обновите данные.</p> : history.length === 0 ? <p className="ui-text-muted">Записей истории пока нет.</p> : <ul>
                {history.map((row) => (
                  <li key={row.id}>
                    {historyLabels[row.action] ?? "План изменён"} ·{" "}
                    {row.actor?.fullName ?? "Система"} ·{" "}
                    {new Date(row.createdAt).toLocaleString("ru-RU", {
                      timeZone: "Europe/Moscow",
                    })}
                  </li>
                ))}
              </ul>}
            </Surface>
          </>
        ) : data ? (
          <Surface padding="md" className={styles.formPanel}>
            <EmptyState title="На этот день плана нет" />
            {data.capabilities.canManage && managerId ? (
              <Stack gap="md">
                <Field label="Срок отчёта, МСК (необязательно)">
                  <DatePicker
                    withTime
                    value={dueAt}
                    onChange={setDueAt}
                    disabled={pending}
                  />
                </Field>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void mutate(() =>
                      createVisitPlan({
                        managerUserId: managerId,
                        planDate: date,
                        ...(dueAt
                          ? {
                              reportDueAt: new Date(
                                `${dueAt}:00+03:00`,
                              ).toISOString(),
                            }
                          : {}),
                      }),
                    )
                  }
                >
                  Создать план
                </Button>
              </Stack>
            ) : null}
          </Surface>
        ) : null}
      </Stack>
    </div>
  );
}

function VisitEntry({
  entry,
  canManage,
  disabled,
  onSave,
}: {
  entry: VisitPlan["entries"][number];
  canManage: boolean;
  disabled: boolean;
  onSave: (visited: boolean, report: string) => Promise<void>;
}): React.JSX.Element {
  const [report, setReport] = useState(entry.visitReport ?? "");
  return (
    <Surface padding="md">
      <Stack gap="md">
        <h3 className="ui-section-title">
          {entry.object?.name ?? entry.clientName}
          {entry.isUnplanned ? " · Внеплановый" : ""}
        </h3>
        <div>
          {entry.visitedAt
            ? `Посещён: ${new Date(entry.visitedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`
            : "Не посещён"}
        </div>
        <div className="ui-text-muted">Добавил: {entry.createdBy.fullName}</div>
        {canManage ? (
          <>
            <Field label="Отчёт о визите">
              <textarea
                value={report}
                maxLength={10000}
                disabled={disabled}
                onChange={(event) => setReport(event.target.value)}
              />
            </Field>
            <div className="ui-inline">
              <Button
                disabled={disabled}
                onClick={() => void onSave(true, report)}
              >
                Сохранить посещение
              </Button>
              {entry.visitedAt ? (
                <Button
                  disabled={disabled}
                  onClick={() => void onSave(false, report)}
                >
                  Снять отметку
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <p className={styles.report}>{entry.visitReport ?? "Отчёт о визите не заполнен."}</p>
        )}
      </Stack>
    </Surface>
  );
}
