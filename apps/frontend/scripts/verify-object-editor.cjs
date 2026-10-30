const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = { exports: {} };
  new Function('exports', 'require', output)(result.exports, (name) => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected runtime dependency: ${name}`);
  });
  return result.exports;
}

const schedule = load('features/object-scheduling/model/schedule-draft.ts');
const setup = load('features/object-setup/model/setup-draft.ts');
const contours = load('features/object-scheduling/model/contour-draft.ts');
const seasons = load('features/object-planning/model/season-planning.ts');
const shiftDay = load('features/object-scheduling/model/shift-day-state.ts');

test('only confirmed facts of the current day own legacy attendance; cancellation releases it', () => {
  const confirmed = { employeeId: 'e1', operationDate: '2026-11-01', status: 'confirmed' };
  assert.deepEqual(shiftDay.confirmedShiftEmployeeIds([confirmed, confirmed, { ...confirmed, employeeId: 'e2', status: 'cancelled' }, { ...confirmed, employeeId: 'e3', operationDate: '2026-10-31' }], '2026-11-01'), ['e1']);
  assert.deepEqual(shiftDay.confirmedShiftEmployeeIds([{ ...confirmed, status: 'cancelled' }], '2026-11-01'), []);
});

test('seasonality off uses base; on transmits explicit annual boundaries without default months', () => {
  assert.deepEqual(seasons.seasonPlanningPayload(false, '', ''), { automaticSeasons: false });
  assert.deepEqual(seasons.seasonPlanningPayload(true, '2026-04-15', '2030-10-20'), { automaticSeasons: true, summerStartsOn: '04-15', winterStartsOn: '10-20' });
  assert.throws(() => seasons.seasonPlanningPayload(true, '', ''));
  assert.throws(() => seasons.seasonPlanningPayload(true, '2028-02-29', '2028-10-20'));
  assert.throws(() => seasons.seasonPlanningPayload(true, '2026-04-15', '2027-04-15'));
});

test('new position starts with weekly 5/2 and leaves staffing unknown', () => {
  const draft = schedule.newPositionDraft();
  draft.name = 'Любая свободная позиция'; draft.effectiveDate = '2026-11-01';
  const payload = schedule.positionPayload(draft);
  assert.equal(schedule.schedulePresets[0].value, 'weekly');
  assert.deepEqual(payload.template.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(payload.template.kind, 'weekly');
  assert.equal(payload.headcount, null);
  assert.equal('requiredPerShift' in payload, false);
  assert.equal(payload.groups.length, 1);
});

test('2/2 adds missing partner without dropping assignments, keys, rates or custom intervals', () => {
  const original = schedule.newPositionDraft();
  original.groups[0].offset = '1';
  original.groups[0].assignments.push({ employeeId: 'existing', employeeName: 'Сотрудник', startDate: '2026-11-01', endDate: '' });
  original.groups[0].intervals[0].contourId = 'draft:cleaning';
  original.groups[0].intervals[0].start = '20:00'; original.groups[0].intervals[0].nextDay = true;
  const changed = schedule.applyPreset(original, '2/2');
  assert.deepEqual(changed.groups[0], original.groups[0]);
  assert.deepEqual(changed.groups.map((group) => group.offset), ['1', '3']);
  assert.equal(changed.groups[1].assignments.length, 0);
  assert.equal(changed.groups[1].intervals[0].contourId, 'draft:cleaning');
  assert.notEqual(changed.groups[1].intervals[0].key, changed.groups[0].intervals[0].key);
  assert.deepEqual(schedule.applyPreset(changed, '2/2').groups, changed.groups);
  assert.equal(original.groups.length, 1);
});

test('headcount does not derive from assignments; independent demand and overnight contour survive', () => {
  const draft = schedule.applyPreset(schedule.newPositionDraft(), '2/2');
  draft.name = 'Уборщица'; draft.effectiveDate = '2026-11-01'; draft.requiredPerShift = '2';
  draft.groups[0].intervals[0] = { ...draft.groups[0].intervals[0], start: '22:00', end: '06:00', nextDay: true, contourId: 'draft:night' };
  draft.groups[0].assignments.push({ employeeId: 'e1', employeeName: 'Сотрудник', startDate: '2026-11-01', endDate: '' });
  const payload = schedule.positionPayload(draft);
  assert.equal(payload.headcount, null); assert.equal(payload.requiredPerShift, 2);
  assert.equal(payload.template.anchorDate, null);
  assert.equal(payload.groups[0].timeRanges[0].endDayOffset, 1);
  assert.equal(payload.groups[0].timeRanges[0].contourId, 'draft:night');
  assert.equal(payload.groups[0].assignments[0].to, null);
});

test('switching presets retains every existing group, even without employees', () => {
  const draft = schedule.applyPreset(schedule.newPositionDraft(), '1/3');
  const original = structuredClone(draft.groups);
  assert.equal(original.length, 4);
  assert.deepEqual(schedule.applyPreset(draft, 'weekly').groups, original);
});

test('forbidden setup fields are omitted, zero and unknown stay distinct', () => {
  const draft = setup.setupDraft(); draft.areaSqM = '0'; draft.contractMonthlyAmount = '500'; draft.coefficient = '1.25';
  const caps = { canEditCore: true, canEditContractAmount: false, canEditCoefficient: false, canEditBudgets: false };
  const payload = setup.setupPayload(draft, caps);
  assert.equal(payload.areaSqM, 0);
  assert.equal(payload.contractStartsOn, null);
  for (const key of ['coefficient', 'budgets', 'contractMonthlyAmount']) assert.equal(key in payload, false);
});

test('budget serialization preserves annual unknown cells and once target month', () => {
  const draft = setup.setupDraft();
  draft.budgets = [
    { category: 'equipment', amount: '1200.50', period: 'annual', monthlyAllocation: ['0', ...Array(11).fill('')], targetMonth: '', plannedOccurrences: '', label: '', notes: '' },
    { category: 'other', amount: '300', period: 'once', monthlyAllocation: null, targetMonth: '2026-11', plannedOccurrences: '', label: 'Разовые работы', notes: '' },
  ];
  const payload = setup.setupPayload(draft, { canEditBudgets: true });
  assert.equal(payload.budgets[0].amount, 1200.50);
  assert.deepEqual(payload.budgets[0].monthlyAllocation, [0, ...Array(11).fill(null)]);
  assert.equal(payload.budgets[1].targetMonth, '2026-11');
});

test('contour zero remains a rate, seasonal blanks inherit, missing base is rejected', () => {
  const draft = contours.newContourDraft(); draft.name = 'Уборка'; draft.dailyRate = '0';
  assert.equal(contours.contourPayload(draft).dailyRate, 0);
  assert.equal(contours.contourPayload(draft).summerDailyRate, null);
  assert.throws(() => contours.contourPayload({ ...draft, dailyRate: '' }));
});

test('atomic object creation keeps nested numeric/null payload and planning off sends base mode only', async () => {
  const calls = [];
  const client = load('entities/object/api/object-client.ts', {
    '@/shared/api/fetcher': { fetcher: async (url, options) => { calls.push({ url, ...options }); return {}; } },
    '../lib/sort-object-options': { sortObjectOptions: (items) => items },
  });
  const draft = schedule.newPositionDraft(); draft.name = 'Уборщица'; draft.effectiveDate = '2026-11-01';
  draft.groups[0].intervals[0].contourId = 'draft:cleaning';
  await client.createObject({ name: 'Объект', address: 'Москва', planning: seasons.seasonPlanningPayload(false, '', ''),
    setup: { areaSqM: 0, contractMonthlyAmount: null }, staffingPositions: [schedule.positionPayload(draft)],
    payContours: [{ code: 'cleaning', name: 'Уборка', dailyRate: 1200, summerDailyRate: null, winterDailyRate: 1500 }], contacts: [],
  });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/objects'); assert.equal(calls[0].method, 'POST');
  const payload = JSON.parse(calls[0].body);
  assert.deepEqual(payload.planning, { automaticSeasons: false });
  assert.equal(payload.setup.areaSqM, 0); assert.equal(payload.setup.contractMonthlyAmount, null);
  assert.equal(payload.staffingPositions[0].groups[0].timeRanges[0].contourId, 'draft:cleaning');
  assert.equal(typeof payload.payContours[0].dailyRate, 'number');
});

test('client sends canonical preview/setup/position/contour/attendance routes and propagates conflicts once', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, ...options }); return {}; };
  const client = load('entities/object/api/object-scheduling-client.ts', { '@/shared/api/fetcher': { fetcher } });
  const setupClient = load('entities/object/api/object-setup-client.ts', { '@/shared/api/fetcher': { fetcher } });
  const position = schedule.newPositionDraft(); position.name = 'Уборщица'; position.effectiveDate = '2026-11-01';
  const draft = schedule.positionPayload(position);
  await client.previewNewObjectSchedule({ from: '2026-11-01', to: '2026-11-02', draft });
  await client.previewSchedule('o1', { from: '2026-11-01', to: '2026-11-02', draft });
  await client.getStaffingPositions('o1'); await client.createStaffingPosition('o1', draft);
  await client.saveStaffingPosition('o1', 'p1', { ...draft, expectedVersion: 2 });
  await client.getPayContours('o1');
  await client.createPayContour('o1', { code: 'day', name: 'День', dailyRate: 500, summerDailyRate: null, winterDailyRate: null });
  await client.savePayContour('o1', 'c1', { expectedVersion: 1, dailyRate: 600 });
  await client.getShiftAttendance('o1', '2026-11-01', '2026-11-01');
  await client.confirmScheduledShift('o1', { positionId: 'p1', revisionId: 'r1', groupKey: 'g1', timeRangeKey: 't1', employeeId: 'e1', operationDate: '2026-11-01' }, 'request1');
  await client.cancelScheduledShift('o1', 'a1', { expectedVersion: 3, reason: 'Ошибочный выход' });
  await setupClient.getObjectSetup('o1'); await setupClient.saveObjectSetup('o1', { expectedVersion: 2, areaSqM: null });
  assert.deepEqual(calls.map((call) => [call.url, call.method ?? 'GET']), [
    ['/object-scheduling/preview', 'POST'], ['/objects/o1/scheduling/preview', 'POST'],
    ['/objects/o1/scheduling/positions', 'GET'], ['/objects/o1/scheduling/positions', 'POST'], ['/objects/o1/scheduling/positions/p1', 'PUT'],
    ['/objects/o1/scheduling/contours', 'GET'], ['/objects/o1/scheduling/contours', 'POST'], ['/objects/o1/scheduling/contours/c1', 'PATCH'],
    ['/objects/o1/scheduling/attendance?from=2026-11-01&to=2026-11-01', 'GET'], ['/objects/o1/scheduling/attendance/confirm', 'POST'],
    ['/objects/o1/scheduling/attendance/a1/cancel', 'POST'],
    ['/objects/o1/setup', 'GET'], ['/objects/o1/setup', 'PATCH'],
  ]);
  assert.equal(JSON.parse(calls[6].body).dailyRate, 500);
  assert.equal(JSON.parse(calls[9].body).requestKey, 'request1');
  assert.deepEqual(JSON.parse(calls[10].body), { expectedVersion: 3, reason: 'Ошибочный выход' });
  let attempts = 0;
  const conflict = new Error('Version conflict');
  const rejecting = load('entities/object/api/object-setup-client.ts', { '@/shared/api/fetcher': { fetcher: async () => { attempts += 1; throw conflict; } } });
  await assert.rejects(rejecting.saveObjectSetup('o1', { expectedVersion: 1, legalName: 'Новое' }), (error) => error === conflict);
  assert.equal(attempts, 1);
});
