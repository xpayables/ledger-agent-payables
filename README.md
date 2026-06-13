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

## Quickstart

Current local flow:

```bash
npm install
npm test
npm run demo:mock
```

Run the local gateway monitor:

```bash
npm run server:mock
```

Open `http://127.0.0.1:4020/dashboard`.

The browser policy console and Arc testnet rail are being ported next.

## Project Layout

```text
core/       policy engine, gateway, signer, budget ledger, payment clients
scripts/    mock server and scripted demo scenario
test/       policy, gateway, signing, budget, and exception tests
```

## Status

* The mock gateway is deterministic and offline.
* The Arc rail and browser policy console are being ported next; the Arc rail will use public testnet funds only.
* This is not production software. It uses demo wallets and in-memory state; do not use with real funds.
