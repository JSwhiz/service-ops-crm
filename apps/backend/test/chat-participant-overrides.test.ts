import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMembershipOverrides, effectiveRoomMembership } from '../src/modules/chats/utils/chat-membership.util';

test('durable exclusion wins over automatic role/assignment and a stale included row', () => {
  const excluded = { membershipOverride: 'exclude', leftAt: null };
  assert.equal(effectiveRoomMembership(true, false, excluded), false);
  assert.equal(effectiveRoomMembership(false, false, excluded), false);
  assert.equal(effectiveRoomMembership(true, false, excluded), false); // automatic role restored
  assert.equal(effectiveRoomMembership(true, true, excluded), false);
});

test('restoring automatic participation restores eligibility, not a blanket grant', () => {
  const restored = { membershipOverride: null, leftAt: null };
  assert.equal(effectiveRoomMembership(true, false, restored), true);
  assert.equal(effectiveRoomMembership(false, false, restored), false);
  assert.equal(effectiveRoomMembership(false, false, { membershipOverride: 'include', leftAt: null }), true);
  assert.equal(effectiveRoomMembership(true, false, { membershipOverride: 'include', leftAt: new Date() }), false);
});

test('legacy explicit memberships and left state remain compatible', () => {
  assert.equal(effectiveRoomMembership(false, true, { membershipOverride: null, leftAt: null }), true);
  assert.equal(effectiveRoomMembership(false, true, { leftAt: new Date() }), false);
  assert.equal(effectiveRoomMembership(false, true, null), false);
  assert.equal(effectiveRoomMembership(true, false, { membershipOverride: 'unknown', leftAt: null }), false);
});

test('recipient union adds manual members, subtracts exclusions and retains unrelated recipients', () => {
  assert.deepEqual(applyMembershipOverrides(['A', 'B'], [
    { userId: 'A', membershipOverride: 'exclude', leftAt: new Date() },
    { userId: 'C', membershipOverride: 'include', leftAt: null },
    { userId: 'D', membershipOverride: 'include', leftAt: new Date() },
  ]), ['B', 'C']);
});
