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

The same policy gateway can drive multiple rails. The Arc script proves real gas-free USDC nanopayment settlement on Circle Arc testnet; the mock rail is an offline fallback; the x402 rail shows the same control model on a standard HTTP 402 flow.

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

Implementation is being ported into this clean repository. Once the code is added, the expected local flow is:

```bash
npm install
npm test
npm run demo:mock
```

Run a real Arc testnet nanopayment:

```bash
npm run wallet:buyer
# fund the printed address at https://faucet.circle.com using Arc Testnet USDC
npm run demo:arc
```

Run the policy console:

```bash
npm run gateway
npm run console
```

Open `http://127.0.0.1:5173`.

A Ledger device is optional for local testing; the console also supports a local test key that produces the same EIP-191 signature format.

## Project Layout

```text
core/       policy engine, gateway, signer, budget ledger, payment clients
scripts/    demo runners and wallet utilities
console/    browser policy console
test/       policy, gateway, signing, budget, and exception tests
```

## Status

* Implementation is being moved from the experimental POC workspace into this clean public repository.
* The mock rail is deterministic and offline. The Arc rail uses public testnet funds only.
* This is not production software. It uses demo wallets and in-memory state; do not use with real funds.
