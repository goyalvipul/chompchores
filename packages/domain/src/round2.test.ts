import test from "node:test";
import assert from "node:assert/strict";
import { round2, todayEarned, validateRoles } from "./index.ts";

test("round2", () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test("validateRoles blocks chore+task", () => {
  const r = validateRoles(["chore", "task"]);
  assert.equal(r.ok, false);
});

test("todayEarned solo", () => {
  const earned = todayEarned(
    [{ id: "a", name: "Bed", pts: 1.5 }],
    { a: true },
    [],
    "2026-08-05"
  );
  assert.equal(earned, 1.5);
});
