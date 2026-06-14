# Ledger Agent Payables

**A Ledger-signed policy control plane for AI-agent USDC nanopayments.**

Ledger Agent Payables lets agents pay for data and services on Circle Arc while a human owner keeps control through a Ledger-signed policy: vendor allowlists, per-payment caps, run and daily budgets, velocity limits, exception approvals, and audit-ready rollups.

## Problem

AI agents can now spend money automatically, creating a critical control problem:

- a runaway loop can drain a wallet one nanopayment at a time
- a compromised agent can pay an attacker-controlled endpoint
- raw wallet transactions are not enough for finance or audit

As traditional finance users adopt agentic payments, they require strict compliance, reconciliation, and audit controls: policy, approvals, attribution, and auditable statements. The control has to move up one level: a human signs the budget and rules once, and the system enforces them on every payment.

## Who It's For

- **Agent developers** who want to route paid requests through a policy-checked gateway instead of calling paid endpoints directly.
- **Operators** running autonomous research, data, monitoring, or coding agents.
- **Finance and ops teams** that need vendor-level budgets, exceptions, and audit trails.

## Product Surface

| Surface               | User            | Job                                                                     |
| --------------------- | --------------- | ----------------------------------------------------------------------- |
| Policy console        | Owner/operator  | Connect Ledger, author a policy, sign it, approve exceptions            |
| Gateway API           | Agent runtime   | Check policy, reserve budget, settle payment, log events                |
| Guarded request API   | Agent developer | Send paid requests through policy enforcement instead of direct fetches |
| Dashboard / statement | Finance / ops   | Review spend, exceptions, budgets, and raw event drill-down             |

## How It Works

The owner signs policy and exception authority with Ledger; the agent spends from a separate hot wallet. The gateway sits between the agent and paid resources:

```text
Owner signs policy with Ledger
-> agent requests paid resource
-> gateway checks policy before payment
-> approved requests settle as USDC nanopayments
-> risky requests are held for human approval
-> events roll up into statements
```

Each guarded payment follows a fail-closed path:

```text
verify signed policy
-> check agent, vendor, amount, velocity, and expiry
-> atomically reserve run + daily budget
-> record the decision event
-> settle payment
-> release or settle the reservation
```

If any control step fails, the gateway blocks the payment before money moves.

The same policy gateway can run against a local mock rail for offline development and Circle Arc testnet for real gas-free USDC nanopayments.

## Quickstart

Install and run the test suite:

```bash
npm install
npm test            # money-logic + gateway suite
```

### Run it on Circle Arc (testnet USDC)

1. Create and fund a throwaway buyer wallet:

```bash
npm run arc:wallet          # prints the buyer address
# fund that address at https://faucet.circle.com (select Arc Testnet)
npm run arc:wallet:status   # confirm the USDC balance landed
```

2. Start the Arc gateway and the browser console in **two separate terminals**:

```bash
# terminal 1 — gateway (deposits into Circle's Gateway, then settles nanopayments)
npm run server:arc

# terminal 2 — browser console
npm run console
```

3. Open `http://127.0.0.1:5173/console/`. Connect a Ledger (or a local test key), sign a policy, run the agent, approve exceptions, and watch budgets, statements, and live decisions — each settled payment links to its Arc transaction.

### Optional: mock rail (no wallet, no funds)

The same gateway and console run against a deterministic, offline mock rail — useful to evaluate the full control flow with zero setup, and as a fallback if the testnet is unavailable. Identical UI; payments are simulated (no on-chain transaction).

```bash
npm run server:mock     # use instead of server:arc — they share port 4020, run only one
npm run console
```

Headless checks (optional, no browser): `npm run demo:mock` runs the full flow on the mock rail; `npm run demo:arc` settles one real Arc nanopayment from the command line.

## Demo

_Screenshot coming soon._

The demo flow:

1. Author a spend policy in the policy console.
2. Sign the policy on a Ledger device.
3. Let the agent make a gas-free USDC nanopayment on Arc testnet.
4. Show the Arc transaction.
5. Trigger an unknown-vendor or over-cap exception.
6. Sign a one-shot exception approval on Ledger.
7. Show the statement rollup.

## Project Layout

```text
console/    browser policy console for policy and exception signatures
core/       policy engine, gateway, signer, budget ledger, payment clients
scripts/    mock and Arc scenario runners
test/       policy, gateway, signing, budget, and exception tests
```

## Status

* The mock gateway is deterministic and offline.
* The Arc rail uses public testnet funds only.
* The browser policy console supports Ledger WebHID and local test signing.
* This is not production software. It uses demo wallets and in-memory state; do not use with real funds.
