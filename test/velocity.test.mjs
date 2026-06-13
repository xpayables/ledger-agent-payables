import test from "node:test";
import assert from "node:assert/strict";
import { createVelocityWindow } from "../core/velocity.mjs";

test("allows up to maxRequestsPerMinute", () => {
  const velocity = createVelocityWindow({ maxRequestsPerMinute: 3 });
  const now = 1_000_000;
  assert.equal(velocity.tryConsume(now), true);
  assert.equal(velocity.tryConsume(now), true);
  assert.equal(velocity.tryConsume(now), true);
  assert.equal(velocity.tryConsume(now), false);
});

test("blocked attempts do not consume capacity", () => {
  const velocity = createVelocityWindow({ maxRequestsPerMinute: 1 });
  const now = 1_000_000;
  assert.equal(velocity.tryConsume(now), true);
  assert.equal(velocity.tryConsume(now), false);
  assert.equal(velocity.tryConsume(now), false);
  assert.equal(velocity.count(now), 1);
});

test("window slides after 60 seconds", () => {
  const velocity = createVelocityWindow({ maxRequestsPerMinute: 1 });
  const now = 1_000_000;
  assert.equal(velocity.tryConsume(now), true);
  assert.equal(velocity.tryConsume(now + 1_000), false);
  assert.equal(velocity.tryConsume(now + 61_000), true);
});
