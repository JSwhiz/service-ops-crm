import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Allow, IsInt, Max, Min } from 'class-validator';

export const OBJECT_SETUP_BUDGET_CATEGORIES = [
  'payroll', 'consumables_cleaning', 'consumables_household',
  'windows', 'taxi', 'tractor', 'carpets', 'deep_cleaning',
  'waste_removal', 'equipment', 'other',
] as const;
export const OBJECT_SETUP_BUDGET_PERIODS = [
  'monthly', 'annual', 'once', 'per_occurrence',
] as const;
export type ObjectSetupBudgetCategory = typeof OBJECT_SETUP_BUDGET_CATEGORIES[number];
export type ObjectSetupBudgetPeriod = typeof OBJECT_SETUP_BUDGET_PERIODS[number];

export interface ObjectSetupBudget {
  category: ObjectSetupBudgetCategory;
  amount: number | null;
  period: ObjectSetupBudgetPeriod;
  monthlyAllocation: (number | null)[] | null;
  targetMonth: string | null;
  plannedOccurrences: number | null;
  label: string | null;
  notes: string | null;
}

export interface ObjectSetupData {
  legalName: string | null;
  areaSqM: number | null;
  plannedLaunchDate: string | null;
  contractStartsOn: string | null;
  contractEndsOn: string | null;
  contractMonthlyAmount: number | null;
  salesResponsibleUserId: string | null;
  coefficient: number | null;
  budgets: ObjectSetupBudget[] | null;
}

// @Allow preserves fields through Nest's whitelist. The pure normalizers below
// validate the complete payload, including nested JSON, on every write path.
// Do not default DTO properties: PATCH must distinguish omitted from null.
export class ObjectSetupDto implements Partial<ObjectSetupData> {
  @Allow() legalName?: string | null;
  @Allow() areaSqM?: number | null;
  @Allow() plannedLaunchDate?: string | null;
  @Allow() contractStartsOn?: string | null;
  @Allow() contractEndsOn?: string | null;
  @Allow() contractMonthlyAmount?: number | null;
  @Allow() salesResponsibleUserId?: string | null;
  @Allow() coefficient?: number | null;
  @Allow() budgets?: ObjectSetupBudget[] | null;
}

export class PatchObjectSetupDto extends ObjectSetupDto {
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedVersion!: number;
}

export interface ObjectSetupCapabilities {
  canEditCore: boolean;
  canViewContractAmount: boolean;
  canEditContractAmount: boolean;
  canViewBudgets: boolean;
  canEditBudgets: boolean;
  canViewCoefficient: boolean;
  canEditCoefficient: boolean;
}

export interface ObjectSetupResponseDto {
  objectId: string;
  version: number;
  data: ObjectSetupData;
  capabilities: ObjectSetupCapabilities;
  budgets: {
    month: string;
    consumablesActualAmount: number | null;
    consumablesSource: string;
    rows: Array<{
      category: ObjectSetupBudgetCategory;
      planAmount: number | null;
      actualAmount: number | null;
      source: string;
    }>;
  };
}

const SETUP_KEYS = [
  'legalName', 'areaSqM', 'plannedLaunchDate', 'contractStartsOn',
  'contractEndsOn', 'contractMonthlyAmount', 'salesResponsibleUserId',
  'coefficient', 'budgets',
] as const satisfies readonly (keyof ObjectSetupData)[];
const MONEY_MAX = 999999999999.99;

function invalid(field: string): never {
  // Never echo request values: these may be commercial secrets.
  throw new BadRequestException(`Некорректное поле setup: ${field}`);
}

function record(input: unknown, allowed: readonly string[], field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(field);
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(`${field}.unknownField`);
  return value;
}

function decimal(input: unknown, field: string, max = MONEY_MAX, places = 2): number | null {
  if (input === null) return null;
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > max) invalid(field);
  if (new Prisma.Decimal(input).decimalPlaces() > places) invalid(field);
  return input === 0 ? 0 : input;
}

function text(input: unknown, field: string, max: number): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || input.length > max) invalid(field);
  const normalized = input.trim();
  if (!normalized.length || Array.from(normalized).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  })) invalid(field);
  return normalized;
}

function calendarDate(input: unknown, field: string): string | null {
  if (input === null) return null;
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) invalid(field);
  const date = new Date(`${input}T00:00:00.000Z`);
  if (input < '1900-01-01' || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) invalid(field);
  return input;
}

function budget(input: unknown): ObjectSetupBudget {
  const row = record(input, ['category', 'amount', 'period', 'monthlyAllocation', 'targetMonth', 'plannedOccurrences', 'label', 'notes'], 'budgets');
  if (!OBJECT_SETUP_BUDGET_CATEGORIES.includes(row.category as ObjectSetupBudgetCategory)) invalid('budgets.category');
  if (!OBJECT_SETUP_BUDGET_PERIODS.includes(row.period as ObjectSetupBudgetPeriod)) invalid('budgets.period');
  const amount = decimal(row.amount, 'budgets.amount');
  let targetMonth: string | null = null;
  if (row.period === 'once') {
    if (typeof row.targetMonth !== 'string' || !/^(?:19|[2-9]\d)\d{2}-(?:0[1-9]|1[0-2])$/.test(row.targetMonth)) invalid('budgets.targetMonth');
    targetMonth = row.targetMonth;
  } else if (row.targetMonth !== undefined && row.targetMonth !== null) invalid('budgets.targetMonth');
  let monthlyAllocation: (number | null)[] | null = null;
  if (row.monthlyAllocation !== undefined && row.monthlyAllocation !== null) {
    if (row.period !== 'annual' || !Array.isArray(row.monthlyAllocation) || row.monthlyAllocation.length !== 12) invalid('budgets.monthlyAllocation');
    // Array.from also validates sparse entries instead of silently skipping holes.
    monthlyAllocation = Array.from(row.monthlyAllocation, (cell) => decimal(cell, 'budgets.monthlyAllocation'));
    const known = monthlyAllocation.filter((cell): cell is number => cell !== null);
    const sum = known.reduce((total, cell) => total.plus(cell), new Prisma.Decimal(0));
    if ((known.length && amount === null) || (amount !== null && (sum.gt(amount) || (known.length === 12 && !sum.eq(amount))))) invalid('budgets.monthlyAllocation.total');
  }
  let plannedOccurrences: number | null = null;
  if (row.plannedOccurrences !== undefined && row.plannedOccurrences !== null) {
    if (['payroll', 'consumables_cleaning', 'consumables_household'].includes(String(row.category)) || typeof row.plannedOccurrences !== 'number' || !Number.isInteger(row.plannedOccurrences) || row.plannedOccurrences < 0 || row.plannedOccurrences > 10000) invalid('budgets.plannedOccurrences');
    plannedOccurrences = row.plannedOccurrences;
  }
  if (row.period === 'per_occurrence' && amount !== null && plannedOccurrences !== null && new Prisma.Decimal(amount).mul(plannedOccurrences).gt(MONEY_MAX)) invalid('budgets.plannedTotal');
  return {
    category: row.category as ObjectSetupBudgetCategory,
    amount,
    period: row.period as ObjectSetupBudgetPeriod,
    monthlyAllocation,
    targetMonth,
    plannedOccurrences,
    label: row.label === undefined ? null : text(row.label, 'budgets.label', 160),
    notes: row.notes === undefined ? null : text(row.notes, 'budgets.notes', 2000),
  };
}

export function normalizeObjectSetupFields(input: unknown): Partial<ObjectSetupData> {
  const source = record(input, SETUP_KEYS, 'setup');
  const result: Partial<ObjectSetupData> = {};
  for (const key of SETUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    // JSON cannot contain undefined; DTO optional fields may be emitted as
    // undefined class fields by tooling. Treat them exactly as omitted.
    if (value === undefined) continue;
    switch (key) {
      case 'legalName': result[key] = text(value, key, 300); break;
      case 'areaSqM': result[key] = decimal(value, key, 999999999.99); break;
      case 'plannedLaunchDate':
      case 'contractStartsOn':
      case 'contractEndsOn': result[key] = calendarDate(value, key); break;
      case 'contractMonthlyAmount': result[key] = decimal(value, key); break;
      case 'coefficient': result[key] = decimal(value, key, 999999.9999, 4); break;
      case 'salesResponsibleUserId':
        if (value !== null && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))) invalid(key);
        result[key] = value as string | null;
        break;
      case 'budgets': {
        if (value === null) { result.budgets = null; break; }
        if (!Array.isArray(value) || value.length > OBJECT_SETUP_BUDGET_CATEGORIES.length) invalid(key);
        const rows = Array.from(value, budget);
        if (new Set(rows.map((row) => row.category)).size !== rows.length) invalid('budgets.duplicateCategory');
        result.budgets = rows;
        break;
      }
    }
  }
  return result;
}

/** Pure normalization of a complete persisted setup or a create payload. */
export function normalizeObjectSetup(input: unknown = {}): ObjectSetupData {
  const result: ObjectSetupData = {
    legalName: null, areaSqM: null, plannedLaunchDate: null,
    contractStartsOn: null, contractEndsOn: null, contractMonthlyAmount: null,
    salesResponsibleUserId: null, coefficient: null, budgets: null,
    ...normalizeObjectSetupFields(input),
  };
  if (result.contractStartsOn && result.contractEndsOn && result.contractStartsOn > result.contractEndsOn) invalid('contractEndsOn');
  return result;
}

export function validateObjectSetup(input: unknown): void {
  normalizeObjectSetup(input);
}

/** Validates patch keys and version; date relations are checked AFTER merge. */
export function normalizeObjectSetupPatch(input: unknown): { expectedVersion: number; changes: Partial<ObjectSetupData> } {
  const source = record(input, ['expectedVersion', ...SETUP_KEYS], 'setup');
  if (typeof source.expectedVersion !== 'number' || !Number.isSafeInteger(source.expectedVersion) || source.expectedVersion < 0 || source.expectedVersion >= Number.MAX_SAFE_INTEGER) invalid('expectedVersion');
  const { expectedVersion, ...fields } = source;
  const changes = normalizeObjectSetupFields(fields);
  if (!Object.keys(changes).length) invalid('emptyPatch');
  return { expectedVersion, changes };
}
