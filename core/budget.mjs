// In-memory two-tier reservation ledger. Production should preserve this
// all-or-nothing contract with a database transaction.
export function createBudgetLedger({ policyDailyAtomic }) {
  let policyReserved = 0;
  let policySettled = 0;
  const runs = new Map();

  function requireRun(runId) {
    const run = runs.get(runId);
    if (!run) throw new Error(`budget ledger: unknown run "${runId}"`);
    return run;
  }

  return {
    registerRun(runId, runBudgetAtomic) {
      runs.set(runId, { runBudgetAtomic, runReserved: 0, runSettled: 0 });
    },

    reserve(runId, amountAtomic) {
      const run = requireRun(runId);
      const runCommitted = run.runReserved + run.runSettled + amountAtomic;
      const policyCommitted = policyReserved + policySettled + amountAtomic;
      if (runCommitted > run.runBudgetAtomic) return { ok: false, tier: "run" };
      if (policyCommitted > policyDailyAtomic) return { ok: false, tier: "policy" };
      run.runReserved += amountAtomic;
      policyReserved += amountAtomic;
      return { ok: true };
    },

    settle(runId, amountAtomic) {
      const run = requireRun(runId);
      run.runReserved -= amountAtomic;
      run.runSettled += amountAtomic;
      policyReserved -= amountAtomic;
      policySettled += amountAtomic;
    },

    release(runId, amountAtomic) {
      const run = requireRun(runId);
      run.runReserved -= amountAtomic;
      policyReserved -= amountAtomic;
    },

    runSnapshot(runId) {
      const run = requireRun(runId);
      return {
        runBudgetAtomic: run.runBudgetAtomic,
        runReserved: run.runReserved,
        runSettled: run.runSettled,
        runRemaining: run.runBudgetAtomic - run.runReserved - run.runSettled,
      };
    },

    policySnapshot() {
      return {
        policyDailyAtomic,
        policyReserved,
        policySettled,
        policyRemaining: policyDailyAtomic - policyReserved - policySettled,
      };
    },
  };
}
