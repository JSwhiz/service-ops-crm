import type { Object as ServiceObject } from "@prisma/client";

export function moscowDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function moscowDayWindow(now = new Date()) {
  const start = new Date(`${moscowDateKey(now)}T00:00:00+03:00`);
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}

export function moscowMonthWindow(now = new Date()) {
  const month = moscowDateKey(now).slice(0, 7);
  const [year, number] = month.split("-").map(Number);
  return {
    month,
    start: new Date(Date.UTC(year, number - 1, 1) - 3 * 3600000),
    end: new Date(Date.UTC(year, number, 1) - 3 * 3600000),
  };
}

export function validAnnualDate(value: string): boolean {
  if (!/^\d{2}-\d{2}$/.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(2001, month - 1, day));
  return (
    month >= 1 &&
    month <= 12 &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function annualSeason(
  summer: string,
  winter: string,
  now = new Date(),
): "summer" | "winter" {
  const day = moscowDateKey(now).slice(5);
  const inSummer =
    summer < winter
      ? day >= summer && day < winter
      : day >= summer || day < winter;
  return inSummer ? "summer" : "winter";
}

export function baseCompensation(
  object: Pick<
    ServiceObject,
    | "baseCompensationProfile"
    | "paymentType"
    | "dailyRate"
    | "monthlySalary"
    | "paymentScheduleCode"
    | "paymentScheduleWeekdays"
  > & { paymentScheduleCycleStartDate: Date | string | null },
) {
  const saved = object.baseCompensationProfile as Record<
    string,
    unknown
  > | null;
  const cycleDate =
    saved && "paymentScheduleCycleStartDate" in saved
      ? saved.paymentScheduleCycleStartDate
      : object.paymentScheduleCycleStartDate;
  return {
    paymentType: (saved?.paymentType ?? object.paymentType) as string,
    dailyRate: Number(saved?.dailyRate ?? object.dailyRate),
    monthlySalary: Number(saved?.monthlySalary ?? object.monthlySalary),
    paymentScheduleCode: (saved && "paymentScheduleCode" in saved
      ? saved.paymentScheduleCode
      : object.paymentScheduleCode) as string | null,
    paymentScheduleWeekdays: (saved?.paymentScheduleWeekdays ??
      object.paymentScheduleWeekdays) as string[],
    paymentScheduleCycleStartDate: cycleDate
      ? new Date(String(cycleDate))
      : null,
  };
}

export function seasonalCompensation(
  object: ServiceObject,
  season: string | null,
) {
  const base = baseCompensation(object);
  if (season !== "summer" && season !== "winter") return base;
  const prefix = season;
  const hasSchedule =
    object[`${prefix}ScheduleCode`] ||
    object[`${prefix}ScheduleWeekdays`].length ||
    object[`${prefix}ScheduleCycleStartDate`];
  return {
    paymentType: object[`${prefix}PaymentType`],
    dailyRate: object[`${prefix}DailyRate`],
    monthlySalary: object[`${prefix}MonthlySalary`],
    paymentScheduleCode: hasSchedule
      ? object[`${prefix}ScheduleCode`]
      : base.paymentScheduleCode,
    paymentScheduleWeekdays: hasSchedule
      ? object[`${prefix}ScheduleWeekdays`]
      : base.paymentScheduleWeekdays,
    paymentScheduleCycleStartDate: hasSchedule
      ? object[`${prefix}ScheduleCycleStartDate`]
      : base.paymentScheduleCycleStartDate,
  };
}
