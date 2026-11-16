import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { pickDashboardRoute } from './dashboard-route.ts';

const user = (roles, capabilities = {}) => ({
  roleCode: roles[0] ?? 'unknown', roleCodes: roles,
  capabilities: { canAccessDashboard: true, ...capabilities },
});
const allVariants = {
  canViewLeadershipDashboard: true, canViewManagerDashboard: true,
  canViewHrDashboard: true, canViewOperationsDashboard: true,
};

test('missing or denied dashboard entry wins over every role and positive variant', () => {
  assert.equal(pickDashboardRoute(null), 'blocked');
  assert.equal(pickDashboardRoute({ roleCode: 'founder', roleCodes: ['founder'] }), 'blocked');
  for (const canAccessDashboard of [false, undefined]) {
    assert.equal(pickDashboardRoute(user(['founder'], { ...allVariants, canAccessDashboard })), 'blocked');
  }
});

test('existing role preference survives only while its server variant is allowed', () => {
  for (const [roles, expected] of [
    [['director', 'hr', 'manager'], 'leadership'], [['hr', 'manager'], 'hr'],
    [['manager'], 'manager'], [['senior_manager'], 'manager'], [['operation_manager'], 'manager'],
  ]) assert.equal(pickDashboardRoute(user(roles, allVariants)), expected);
  assert.equal(pickDashboardRoute(user(['director', 'hr'], { ...allVariants, canViewLeadershipDashboard: false })), 'hr');
});

test('an explicit variant capability works without membership in that role', () => {
  for (const [flag, expected] of [
    ['canViewLeadershipDashboard', 'leadership'], ['canViewHrDashboard', 'hr'],
    ['canViewManagerDashboard', 'manager'], ['canViewOperationsDashboard', 'operations'],
  ]) assert.equal(pickDashboardRoute(user(['manager'], { [flag]: true })), expected);
});

test('operation manager switches to the actual operations alias when manager is denied', () => {
  assert.equal(pickDashboardRoute(user(['operation_manager'], {
    canViewManagerDashboard: false, canViewOperationsDashboard: true,
  })), 'operations');
});

test('roles never recreate a missing/denied variant; generic workspace needs real entry', () => {
  assert.equal(pickDashboardRoute(user(['founder', 'hr', 'operation_manager'])), 'workspace');
  assert.equal(pickDashboardRoute(user([], {
    canViewLeadershipDashboard: false, canViewManagerDashboard: false,
    canViewHrDashboard: false, canViewOperationsDashboard: false,
  })), 'workspace');
});

test('revoke and regrant choose fresh permitted routes without remembered role authorization', () => {
  const actor = user(['director'], { canViewLeadershipDashboard: true });
  assert.equal(pickDashboardRoute(actor), 'leadership');
  assert.equal(pickDashboardRoute({ ...actor, capabilities: { ...actor.capabilities, canAccessDashboard: false } }), 'blocked');
  assert.equal(pickDashboardRoute({ ...actor, capabilities: { canAccessDashboard: true, canViewHrDashboard: true } }), 'hr');
  assert.equal(pickDashboardRoute(actor), 'leadership');
});

// Structural checks prove wiring only, not React lifecycle or HTTP behavior.
test('every live dashboard child is keyed by the current access revision', () => {
  const source = readFileSync(new URL('../ui/dashboard-role-router.tsx', import.meta.url), 'utf8');
  assert.match(source, /const accessRevision = useAccessRevision\(\)/);
  for (const component of ['LeadershipDashboard', 'HrDashboard', 'ManagerDashboard', 'OperationManagerDashboard', 'DashboardWorkspace']) {
    assert.ok(source.includes(`<${component} key={accessRevision} />`));
  }
  assert.match(source, /switch \(pickDashboardRoute\(user\)\)/);
});

test('fallback guards domain requests before starting them and renders a denied state', () => {
  const source = readFileSync(new URL('../ui/dashboard-workspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /const canAccessDashboard = user\?\.capabilities\?\.canAccessDashboard === true/);
  const effect = source.slice(source.indexOf('useEffect(() => {'));
  assert.ok(effect.indexOf('if (!canAccessDashboard) return;') < effect.indexOf('listApprovalRequests('));
  assert.match(source, /\}, \[canAccessDashboard,/);
  assert.match(source, /if \(!canAccessDashboard\) return <Surface[^\n]+title="Рабочий стол недоступен"/);
  assert.match(source, /const accounts = await[^\n]+\n\s+if \(!active\) return EMPTY_MONEY;/);
});
