const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ORDER_STATUS_TRANSITIONS,
  ORDER_STATUSES,
  isOrderStatusTransitionAllowed,
  isOrderStatusTransitionAllowedForRole,
} = require("../backend/business-constants");

test("order state machine allows the supported forward and cancellation paths", () => {
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.RECEIVED, ORDER_STATUSES.PROCESSING),
    true,
  );
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.PROCESSING, ORDER_STATUSES.SHIPPING),
    true,
  );
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.SHIPPING, ORDER_STATUSES.COMPLETED),
    true,
  );
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.RECEIVED, ORDER_STATUSES.CANCELLED),
    true,
  );
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.COMPLETED, ORDER_STATUSES.COMPLETED),
    true,
  );
});

test("order state machine rejects skipped, backward and terminal transitions", () => {
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.RECEIVED, ORDER_STATUSES.SHIPPING),
    false,
  );
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.SHIPPING, ORDER_STATUSES.PROCESSING),
    false,
  );
  assert.equal(
    isOrderStatusTransitionAllowed(ORDER_STATUSES.COMPLETED, ORDER_STATUSES.CANCELLED),
    false,
  );
  assert.deepEqual(ORDER_STATUS_TRANSITIONS[ORDER_STATUSES.CANCELLED], []);
  assert.equal(isOrderStatusTransitionAllowed("unknown", ORDER_STATUSES.RECEIVED), false);
});

test("order state machine applies role-specific transition permissions", () => {
  assert.equal(
    isOrderStatusTransitionAllowedForRole(
      ORDER_STATUSES.RECEIVED,
      ORDER_STATUSES.PROCESSING,
      "admin",
    ),
    true,
  );
  assert.equal(
    isOrderStatusTransitionAllowedForRole(
      ORDER_STATUSES.RECEIVED,
      ORDER_STATUSES.PROCESSING,
      "user",
    ),
    false,
  );
  assert.equal(
    isOrderStatusTransitionAllowedForRole(
      ORDER_STATUSES.RECEIVED,
      ORDER_STATUSES.CANCELLED,
      "user",
    ),
    true,
  );
});
