import test from "node:test";
import assert from "node:assert/strict";
import { createBudgetLedger } from "../core/budget.mjs";
import { usd } from "../core/money.mjs";

function ledgerWith({ policyDaily, runBudget, runId = "run_1" }) {
  const budget = createBudgetLedger({ policyDailyAtomic: policyDaily });
  budget.registerRun(runId, runBudget);
  return budget;
}

test("run budget rejects over-committed reservations", () => {
  const budget = ledgerWith({ policyDaily: usd(1), runBudget: usd(0.03) });
  assert.equal(budget.reserve("run_1", usd(0.02)).ok, true);
  const second = budget.reserve("run_1", usd(0.02));
  assert.equal(second.ok, false);
  assert.equal(second.tier, "run");
});

test("policy budget is shared across runs", () => {
  const budget = createBudgetLedger({ policyDailyAtomic: usd(0.03) });
  budget.registerRun("run_a", usd(1));
  budget.registerRun("run_b", usd(1));
  assert.equal(budget.reserve("run_a", usd(0.02)).ok, true);
  const second = budget.reserve("run_b", usd(0.02));
  assert.equal(second.ok, false);
  assert.equal(second.tier, "policy");
});

test("failed payment release restores both tiers", () => {
  const budget = ledgerWith({ policyDaily: usd(1), runBudget: usd(0.03) });
  budget.reserve("run_1", usd(0.02));
  budget.release("run_1", usd(0.02));
  assert.equal(budget.runSnapshot("run_1").runRemaining, usd(0.03));
  assert.equal(budget.policySnapshot().policyRemaining, usd(1));
});

test("settle moves reserved amount to settled", () => {
  const budget = ledgerWith({ policyDaily: usd(1), runBudget: usd(0.03) });
  budget.reserve("run_1", usd(0.02));
  budget.settle("run_1", usd(0.02));
  const snapshot = budget.runSnapshot("run_1");
  assert.equal(snapshot.runReserved, 0);
  assert.equal(snapshot.runSettled, usd(0.02));
  assert.equal(snapshot.runRemaining, usd(0.01));
});
