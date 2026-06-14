// Unified browser console for policy signing, deterministic agent runs, and monitoring.
import { Buffer } from "buffer";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ARC_TESTNET, ARC_TESTNET_USDC, ARCSCAN } from "../core/arc-config.mjs";
import { fromAtomic, usd } from "../core/money.mjs";
import { approvalMessageHex, policyMessageHex } from "../core/policy-message.mjs";

globalThis.Buffer = Buffer;

const DERIVATION_PATH = "44'/60'/0'/0/0";
let gatewayUrl = localStorage.getItem("ledger-agent-payables.gateway") || "http://127.0.0.1:4020";
let signer = null;
let activePolicy = null;
let activeRunId = "run_console_001";
let demoTargets = [];
let agentRunning = false;
let editingPolicy = true;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const fmtUsd = (amountAtomic) => `$${fromAtomic(amountAtomic)}`;
const short = (value, n = 14) => {
  if (value == null) return "";
  const text = String(value);
  return text.length > n ? `${text.slice(0, n)}...` : text;
};
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function setGateway(next) {
  gatewayUrl = next.replace(/\/+$/, "");
  localStorage.setItem("ledger-agent-payables.gateway", gatewayUrl);
  $("#gateway-status").textContent = "Gateway connecting…";
}

function setTab(name) {
  $$(".nav button[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $("#agent-view").hidden = name !== "agent";
  $("#monitor-view").hidden = name !== "monitor";
}

function pill(value) {
  const label = String(value ?? "").replace("_", " ");
  const cls = value === "approved" ? "approved"
    : value === "blocked" ? "blocked"
      : value === "pending" || value === "needs_approval" ? "needs_approval"
        : "pending";
  return `<span class="pill ${cls}">${escapeHtml(label)}</span>`;
}

async function makeLocalSigner() {
  const account = privateKeyToAccount(generatePrivateKey());
  return {
    mode: "local",
    address: account.address,
    async signMessageHex(hex) {
      return {
        signature: await account.signMessage({ message: { raw: `0x${hex}` } }),
        signatureType: "ledger-eip191",
        signer: account.address,
      };
    },
  };
}

async function makeLedgerSigner() {
  if (!("hid" in navigator)) throw new Error("WebHID is unavailable in this browser.");
  const [{ default: TransportWebHID }, { default: Eth }] = await Promise.all([
    import("@ledgerhq/hw-transport-webhid"),
    import("@ledgerhq/hw-app-eth"),
  ]);
  const transport = await TransportWebHID.create();
  const eth = new Eth(transport);
  const { address } = await eth.getAddress(DERIVATION_PATH, true);
  return {
    mode: "ledger",
    address,
    async signMessageHex(hex) {
      const sig = await eth.signPersonalMessage(DERIVATION_PATH, hex);
      return {
        signature: { r: `0x${sig.r}`, s: `0x${sig.s}`, v: Number(sig.v) },
        signatureType: "ledger-eip191",
        signer: address,
      };
    },
  };
}

function unlock(selector) {
  $(selector)?.classList.remove("is-disabled");
}

function policyInputs() {
  return [...document.querySelectorAll("#policy-panel input, #policy-panel select")];
}

function setPolicyLocked(policy, locked) {
  editingPolicy = !locked;
  $("#policy-panel").classList.toggle("policy-locked", locked);
  $("#policy-form-state").textContent = locked ? "Active" : "Draft";
  $("#policy-form-state").classList.toggle("is-active", locked);
  $("#sign-policy").hidden = locked;
  $("#edit-policy").hidden = !locked;
  policyInputs().forEach((input) => {
    input.disabled = locked;
  });
  if (policy) {
    $("#f-agent").value = policy.agentId;
    $("#f-vendors").value = policy.allowedVendors.join(", ");
    $("#f-cap").value = fromAtomic(policy.maxAmountAtomic);
    $("#f-budget").value = fromAtomic(policy.dailyBudgetAtomic);
    $("#f-velocity").value = String(policy.maxRequestsPerMinute);
  }
}

function chat(role, text, detail = "") {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.innerHTML = `<b>${role === "agent" ? "Agent" : role === "gateway" ? "Gateway" : "You"}</b>${escapeHtml(text)}${detail ? `<div class="note">${escapeHtml(detail)}</div>` : ""}`;
  $("#chat-log").append(bubble);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
}

function resetChat() {
  $("#chat-log").innerHTML = "";
  chat("agent", "Ready. Sign a policy, then I can request paid resources through the gateway.");
}

function readMoneyField(id) {
  const value = Number($(id).value);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${id.slice(3)} must be positive`);
  return usd(value);
}

function readPolicyForm() {
  if (!signer) throw new Error("connect a signer first");
  const vendors = $("#f-vendors").value.split(",").map((item) => item.trim()).filter(Boolean);
  if (vendors.length === 0) throw new Error("add at least one allowed vendor");
  const velocity = Number($("#f-velocity").value);
  const hours = Number($("#f-expiry").value);
  if (!Number.isSafeInteger(velocity) || velocity <= 0) throw new Error("requests per minute must be a positive integer");
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("expiry must be positive");
  return {
    id: `policy_console_${Date.now()}`,
    gatewayDomain: new URL(gatewayUrl).host,
    network: ARC_TESTNET,
    currency: "USDC",
    asset: ARC_TESTNET_USDC,
    agentId: $("#f-agent").value.trim(),
    ownerAddress: signer.address,
    allowedVendors: vendors,
    maxAmountAtomic: readMoneyField("#f-cap"),
    dailyBudgetAtomic: readMoneyField("#f-budget"),
    maxRequestsPerMinute: velocity,
    expiresAt: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };
}

async function jget(path) {
  const response = await fetch(`${gatewayUrl}${path}`);
  if (!response.ok) throw new Error(`GET ${path} failed with HTTP ${response.status}`);
  return response.json();
}

async function loadDemoTargets() {
  try {
    const body = await jget("/demo-targets");
    demoTargets = body.targets ?? [];
  } catch {
    demoTargets = [];
  }
}

function targetByKind(kind) {
  return demoTargets.find((item) => item.kind === kind);
}

async function fire(target, key = target.kind) {
  if (!activePolicy) throw new Error("no active policy");
  if (!target) throw new Error("target unavailable");
  $("#agent-state").textContent = `sending`;
  const response = await fetch(`${gatewayUrl}/guarded-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: activePolicy.agentId,
      runId: activeRunId,
      resourceUrl: target.resourceUrl,
      method: target.method,
      body: target.body,
      idempotencyKey: `${key}-${crypto.randomUUID()}`,
    }),
  });
  const body = await response.json();
  $("#agent-state").textContent = body.decision ?? body.error ?? "waiting";
  await refresh();
  return { status: response.status, body, target };
}

function summarizeDecision(result) {
  const { status, body } = result;
  const tx = body.paidResource?.settlement?.transaction;
  if (body.decision === "approved") {
    return {
      text: `Approved ${fmtUsd(body.amountAtomic)} and settled the resource request.`,
      detail: tx ? `Arc tx ${short(tx, 18)}` : `HTTP ${status}; ${body.reason}`,
    };
  }
  if (body.decision === "needs_approval") {
    return {
      text: `Held ${fmtUsd(body.amountAtomic)} for owner approval.`,
      detail: `${body.reason}; exception ${short(body.exceptionId, 18)}`,
    };
  }
  return {
    text: `Blocked before payment.`,
    detail: `HTTP ${status}; ${body.reason ?? body.error}`,
  };
}

async function runAgentScenario() {
  if (agentRunning) return;
  if (!activePolicy) {
    chat("gateway", "No active policy. Switch to Policy & Monitor and sign one first.");
    setTab("monitor");
    return;
  }
  if (demoTargets.length === 0) {
    chat("gateway", "No paid targets are available. Start npm run server:mock or npm run server:arc.");
    return;
  }

  agentRunning = true;
  $("#agent-state").textContent = "running";
  try {
    chat("user", $("#chat-prompt").value.trim() || "Run the research task.");

    const steps = [
      ["agent", "I need current weather data before drafting the research note.", "allowed"],
      ["agent", "I found a premium forecast package. Checking whether it fits the policy.", "overcap"],
      ["agent", "I also want a market quote from a new vendor.", "unknown"],
    ];
    for (const [role, text, kind] of steps) {
      chat(role, text);
      const result = await fire(targetByKind(kind), `agent-${kind}`);
      const summary = summarizeDecision(result);
      chat("gateway", summary.text, summary.detail);
    }
    chat("agent", "Run complete. Review the monitor for budget, exceptions, statement rows, and any Arcscan tx links.");
  } catch (error) {
    chat("gateway", `Run stopped: ${error.message}`);
  } finally {
    agentRunning = false;
    $("#agent-state").textContent = "waiting";
  }
}

async function approve(exceptionId, button) {
  button.disabled = true;
  try {
    if (!signer) throw new Error("connect a signer first");
    const body = await jget(`/exceptions/${exceptionId}/message`);
    const exception = (await jget("/exceptions")).exceptions.find((item) => item.id === exceptionId);
    if (!exception) throw new Error("exception not found");
    $("#approve-status").textContent = signer.mode === "ledger"
      ? "Review exception approval on the Ledger device."
      : "Signing exception approval.";
    const approval = await signer.signMessageHex(body.messageHex ?? approvalMessageHex(exception));
    const response = await fetch(`${gatewayUrl}/exceptions/${exceptionId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    $("#approve-status").textContent = "approved";
    const tx = result.paidResource?.settlement?.transaction;
    chat("gateway", "Exception approved and replayed through the payment rail.", tx ? `Arc tx ${short(tx, 18)}` : "");
  } catch (error) {
    $("#approve-status").textContent = `failed: ${error.message}`;
    button.disabled = false;
  }
  await refresh();
}

function renderPolicyState(body) {
  const policy = body.policy;
  if (!policy) {
    $("#policy-chip").textContent = "No active policy";
    $("#policy-chip").classList.remove("is-on");
    activePolicy = null;
    if (signer) setPolicyLocked(null, false);
    return;
  }
  $("#policy-chip").textContent = "Policy active";
  $("#policy-chip").classList.add("is-on");
  const firstSeenPolicy = !activePolicy;
  activePolicy = policy;
  if (firstSeenPolicy || !editingPolicy) setPolicyLocked(policy, true);
}

function renderBudget(body) {
  if (!body.policy) {
    $("#budget").innerHTML = '<div class="note">No active policy.</div>';
    return;
  }
  const rows = [
    ["Policy daily", body.policy.policyDailyAtomic, body.policy.policyReserved + body.policy.policySettled],
    ...body.runs.map((run) => [run.taskLabel || run.id, run.runBudgetAtomic, run.runReserved + run.runSettled]),
  ];
  $("#budget").innerHTML = rows.map(([label, total, used]) => {
    const width = total ? Math.min(100, (used / total) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-meta"><span class="bar-title">${escapeHtml(label)}</span><span>${fmtUsd(used)} of ${fmtUsd(total)}</span></div>
      <div class="bar"><i style="width:${width}%"></i></div>
    </div>`;
  }).join("");
}

function renderExceptions(exceptions) {
  $("#exceptions-table").innerHTML = `
    <tr><th>Type</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Approval</th></tr>
    ${exceptions.map((item) => `<tr>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.vendorId)}</td>
      <td>${fmtUsd(item.amountAtomic)}</td>
      <td>${pill(item.status === "pending" ? "needs_approval" : item.status)}</td>
      <td>${item.status === "pending"
        ? `<button class="btn warning" data-approve="${escapeHtml(item.id)}">Sign</button>`
        : `<span class="mono">${escapeHtml(short(item.approverAddress, 18))}</span>`}</td>
    </tr>`).join("") || '<tr><td colspan="5" class="note">No exceptions.</td></tr>'}`;
  $$("#exceptions-table button[data-approve]").forEach((button) => {
    button.addEventListener("click", () => approve(button.dataset.approve, button));
  });
}

function renderStatement(body) {
  const rows = body.rows ?? [];
  $("#statement-bars").innerHTML = rows.slice(0, 3).map((row) => {
    const width = row.attemptedUsd > 0 ? Math.min(100, (Number(row.approvedUsd) / Number(row.attemptedUsd)) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-meta"><span class="bar-title">${escapeHtml(row.vendorId)}</span><span>$${escapeHtml(row.approvedUsd)} approved</span></div>
      <div class="bar"><i style="width:${width}%"></i></div>
    </div>`;
  }).join("");
  $("#statement-table").innerHTML = `
    <tr><th>Vendor</th><th>Decision</th><th>#</th><th>Approved</th></tr>
    ${rows.map((row) => `<tr>
      <td>${escapeHtml(row.vendorId)}</td>
      <td>${pill(row.decision)}</td>
      <td>${row.requestCount}</td>
      <td>$${escapeHtml(row.approvedUsd)}</td>
    </tr>`).join("") || '<tr><td colspan="4" class="note">No activity.</td></tr>'}`;
}

function renderEvents(events) {
  $("#events-table").innerHTML = `
    <tr><th>Time (UTC)</th><th>Vendor</th><th>Resource</th><th>Amount</th><th>Decision</th><th>Reason</th><th>Status</th></tr>
    ${events.map((event) => {
      const tx = event.txHash ? ` <a target="_blank" href="${ARCSCAN}/tx/${encodeURIComponent(event.txHash)}">tx</a>` : "";
      return `<tr title="${escapeHtml(event.resourceUrl)}">
        <td>${new Date(event.createdAt).toISOString().slice(11, 19)}</td>
        <td>${escapeHtml(event.vendorId)}</td>
        <td class="mono">${escapeHtml(event.resourceUrl)}</td>
        <td>${fmtUsd(event.amountAtomic)}</td>
        <td>${pill(event.decision)}</td>
        <td>${escapeHtml(event.decisionReason)}</td>
        <td>${escapeHtml(event.status)}${tx}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="7" class="note">No decisions yet.</td></tr>'}`;
}

async function refresh() {
  try {
    const [policy, budget, exceptions, statement, events] = await Promise.all([
      jget("/policy"),
      jget("/budget"),
      jget("/exceptions"),
      jget("/statement"),
      jget("/events"),
    ]);
    renderPolicyState(policy);
    renderBudget(budget);
    renderExceptions(exceptions.exceptions ?? []);
    renderStatement(statement);
    renderEvents(events.events ?? []);
    $("#gateway-status").textContent = "Gateway connected";
    $("#gateway-status").classList.add("is-on");
    $("#gateway-status").classList.remove("is-error");
  } catch (error) {
    $("#gateway-status").textContent = "Gateway unavailable";
    $("#gateway-status").classList.add("is-error");
    $("#gateway-status").classList.remove("is-on");
  }
}

setGateway(gatewayUrl);
resetChat();

$$(".nav button[data-tab]").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

$("#connect").addEventListener("click", async () => {
  const mode = $("#signer-mode").value;
  $("#connect-status").textContent = mode === "ledger"
    ? "Connecting. Select the Ledger device and open the Ethereum app."
    : "Creating a local test signer.";
  try {
    signer = mode === "ledger" ? await makeLedgerSigner() : await makeLocalSigner();
    $("#owner-address").textContent = short(signer.address, 24);
    $("#owner-chip").textContent = `${signer.mode} ${short(signer.address, 18)}`;
    $("#owner-chip").classList.add("is-on");
    $("#signer-state").textContent = "connected";
    $("#signer-state").classList.add("is-active");
    $("#connect-status").textContent = signer.mode === "ledger"
      ? "Connected. Use the device to review policy and exception messages."
      : "Local signer ready. This is the no-hardware demo fallback.";
    unlock("#policy-panel");
    if (!activePolicy) setPolicyLocked(null, false);
    chat("gateway", `Signer connected: ${short(signer.address, 18)}.`);
  } catch (error) {
    $("#connect-status").textContent = `Connect failed: ${error.message}`;
  }
});

$("#sign-policy").addEventListener("click", async () => {
  try {
    const policy = readPolicyForm();
    $("#policy-status").textContent = signer.mode === "ledger"
      ? "Review the policy on the Ledger device."
      : "Signing policy with local test key.";
    const signed = await signer.signMessageHex(policyMessageHex(policy));
    const response = await fetch(`${gatewayUrl}/policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy, signed, runBudgetAtomic: policy.dailyBudgetAtomic }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    activePolicy = policy;
    activeRunId = body.runId;
    $("#policy-chip").textContent = "Policy active";
    $("#policy-chip").classList.add("is-on");
    $("#policy-status").textContent = `Active policy ${body.runId}. Sign again after editing to replace the current session.`;
    setPolicyLocked(policy, true);
    await loadDemoTargets();
    await refresh();
    chat("gateway", `Policy active for ${policy.agentId}. Allowed vendors: ${policy.allowedVendors.join(", ")}.`);
    setTab("agent");
  } catch (error) {
    $("#policy-status").textContent = `Activation failed: ${error.message}`;
  }
});

$("#edit-policy").addEventListener("click", () => {
  setPolicyLocked(activePolicy, false);
  $("#policy-status").textContent = "Editing draft. Sign again to replace the active gateway session.";
});

$("#run-agent").addEventListener("click", runAgentScenario);

await loadDemoTargets();
await refresh();
setInterval(refresh, 1500);
