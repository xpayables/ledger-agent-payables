// HTML dashboard for operating the local gateway; data comes from gateway JSON endpoints.
export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ledger Agent Payables</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:," />
<style>
  :root {
    --page:#f5f7fb;
    --surface:#ffffff;
    --surface-alt:#f7f8fc;
    --ink:#171a1f;
    --muted:#727887;
    --line:#e7ebf2;
    --line-dark:#cbd3df;
    --blue:#4f75de;
    --blue-soft:#eef4ff;
    --teal:#30b8ae;
    --teal-soft:#e8fbf8;
    --green:#27825a;
    --green-soft:#eaf8f0;
    --amber:#b87510;
    --amber-soft:#fff4d8;
    --red:#c45a58;
    --red-soft:#fff0ef;
    --lavender:#8c7bee;
    --lavender-soft:#f2f0ff;
    --charcoal:#2d333b;
  }
  * { box-sizing:border-box; }
  body {
    margin:0;
    background:
      linear-gradient(120deg, rgba(238, 244, 255, .92), rgba(255, 249, 242, .78) 46%, rgba(232, 251, 248, .68)),
      var(--page);
    color:var(--ink);
    font:14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, Helvetica, sans-serif;
  }
  button, input { font:inherit; }
  body { overflow-x:hidden; }
  .layout { min-height:100vh; }
  main { width:min(100%, 1260px); margin:0 auto; padding:24px 20px 18px; min-width:0; }
  .topbar {
    margin-bottom:11px;
  }
  h1 {
    margin:0;
    font-size:30px;
    line-height:1.15;
    font-weight:800;
    letter-spacing:0;
  }
  .subtitle { margin-top:7px; color:var(--muted); font-size:14px; max-width:860px; }
  .meta-row {
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    color:var(--muted);
    font-size:12px;
    margin:0 0 16px;
  }
  .meta-row span {
    display:inline-flex;
    align-items:center;
    gap:6px;
    background:rgba(255, 255, 255, .72);
    border:0;
    border-radius:999px;
    padding:5px 10px;
    box-shadow:0 1px 1px rgba(20, 28, 38, .03);
  }
  .meta-row span::before {
    content:"";
    width:7px;
    height:7px;
    border:1px solid rgba(39, 130, 90, .45);
    background:var(--green-soft);
  }
  .label {
    color:var(--muted);
    font-size:12px;
    letter-spacing:0;
    font-weight:700;
  }
  .grid { display:grid; gap:9px; }
  .kpis { grid-template-columns:repeat(4, minmax(0, 1fr)); margin-bottom:9px; }
  .content-grid { grid-template-columns:minmax(360px, .78fr) minmax(0, 1.22fr); align-items:stretch; margin-bottom:9px; }
  .panel {
    background:rgba(255, 255, 255, .88);
    border:0;
    border-radius:10px;
    min-width:0;
    overflow:hidden;
    box-shadow:0 8px 24px rgba(31, 42, 68, .06), 0 1px 2px rgba(31, 42, 68, .04);
  }
  .panel-head {
    min-height:34px;
    padding:8px 14px;
    border-bottom:0;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:12px;
  }
  .panel h2 {
    margin:0;
    font-size:15px;
    line-height:1.2;
    font-weight:800;
  }
  .panel-body { padding:4px 14px 10px; }
  .kpi {
    position:relative;
    background:rgba(255, 255, 255, .9);
    border:0;
    border-radius:10px;
    min-height:60px;
    padding:9px 12px;
    overflow:hidden;
    box-shadow:0 8px 20px rgba(31, 42, 68, .055), 0 1px 2px rgba(31, 42, 68, .04);
  }
  .kpi::before {
    content:"";
    position:absolute;
    inset:0 0 auto;
    height:3px;
    background:var(--blue);
  }
  .kpi:nth-child(2)::before { background:var(--teal); }
  .kpi:nth-child(3)::before { background:#f4b63f; }
  .kpi:nth-child(4)::before { background:var(--lavender); }
  .kpi .value { font-size:20px; line-height:1.2; font-weight:800; margin-top:3px; color:var(--charcoal); }
  .kpi .hint { color:var(--muted); font-size:12px; margin-top:2px; }
  .stack { display:flex; flex-direction:column; gap:9px; }
  .left-stack { display:grid; gap:9px; grid-template-columns:1fr; grid-template-rows:minmax(0, 1fr) auto auto; min-height:100%; }
  .left-stack .panel { min-height:0; }
  .right-stack { display:grid; grid-template-rows:minmax(0, 1fr) auto; gap:9px; min-height:100%; }
  .right-stack .panel { min-height:0; }
  .scroll-window {
    overflow:auto;
    scrollbar-gutter:stable;
    scrollbar-color:#c8d2e2 transparent;
  }
  .policy-scroll { max-height:126px; }
  .statement-bars { margin-bottom:8px; }
  .statement-scroll { max-height:128px; }
  .exceptions-scroll { max-height:122px; }
  .events-scroll { max-height:174px; }
  .kv { display:grid; gap:0; }
  .kv div {
    display:grid;
    grid-template-columns:118px minmax(0, 1fr);
    gap:12px;
    border-bottom:1px solid #edf1f6;
    padding:4px 0;
  }
  .kv div:last-child { border-bottom:0; }
  .kv span:first-child { color:var(--muted); }
  .mono {
    font-family:"SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size:12px;
    overflow-wrap:anywhere;
  }
  .bar-row { margin-bottom:8px; }
  .bar-row:last-child { margin-bottom:0; }
  .bar-meta { display:flex; justify-content:space-between; gap:12px; margin-bottom:4px; }
  .bar-title, .row-label { color:var(--muted); font-weight:700; }
  .bar-amount { color:var(--muted); font-size:12px; white-space:nowrap; }
  .bar {
    height:8px;
    background:#eef2f7;
    border:0;
    border-radius:999px;
    overflow:hidden;
    box-shadow:inset 0 0 0 1px rgba(199, 209, 224, .55);
  }
  .bar i {
    display:block;
    height:100%;
    border-radius:999px;
    background:linear-gradient(90deg, #6f8ee9, #57c9bf);
  }
  table {
    width:100%;
    border-collapse:separate;
    border-spacing:0;
    font-size:13px;
    table-layout:fixed;
  }
  th {
    position:sticky;
    top:0;
    z-index:2;
    text-align:left;
    color:var(--muted);
    background:var(--surface-alt);
    font-weight:700;
    padding:6px 9px;
    border-bottom:0;
    box-shadow:0 1px 0 var(--line);
    white-space:nowrap;
  }
  .panel-body.scroll-window { padding-top:0; }
  td {
    padding:6px 9px;
    border-bottom:1px solid #edf1f6;
    vertical-align:top;
    overflow-wrap:anywhere;
  }
  tr:last-child td { border-bottom:0; }
  #events-table th:nth-child(1), #events-table td:nth-child(1) { width:92px; }
  #events-table th:nth-child(2), #events-table td:nth-child(2) { width:128px; }
  #events-table th:nth-child(3), #events-table td:nth-child(3) { width:auto; }
  #events-table th:nth-child(4), #events-table td:nth-child(4) { width:80px; }
  #events-table th:nth-child(5), #events-table td:nth-child(5) { width:112px; }
  #events-table th:nth-child(6), #events-table td:nth-child(6) { width:160px; }
  #events-table th:nth-child(7), #events-table td:nth-child(7) { width:180px; }
  #events-table td {
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    vertical-align:middle;
  }
  .pill {
    display:inline-flex;
    align-items:center;
    min-height:22px;
    padding:2px 9px;
    border:0;
    border-radius:999px;
    font-size:12px;
    font-weight:700;
    white-space:nowrap;
  }
  .approved { color:var(--green); background:var(--green-soft); }
  .needs_approval { color:var(--amber); background:var(--amber-soft); }
  .blocked { color:var(--red); background:var(--red-soft); }
  .empty { color:var(--muted); padding:12px 0; }
  .controls { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; }
  .btn {
    border:0;
    background:#fff;
    color:var(--ink);
    border-radius:10px;
    padding:7px 8px;
    cursor:pointer;
    min-height:36px;
    width:100%;
    font-size:13px;
    line-height:1.25;
    box-shadow:0 2px 8px rgba(31, 42, 68, .05);
  }
  .btn.primary {
    background:linear-gradient(135deg, #e7edff, #e8f8f6);
    color:#3152b7;
  }
  .btn.warning {
    background:#ffefb7;
    color:#7b5400;
  }
  .btn:not(.primary):not(.warning) { background:#f8f9fc; color:#353b46; }
  .btn:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 8px 18px rgba(31, 42, 68, .1); }
  .btn:disabled { opacity:.48; cursor:default; }
  .status-line { color:var(--muted); font-size:12px; min-height:16px; }
  .wide { grid-column:1 / -1; }
  @media (max-width:1050px) {
    .content-grid, .kpis { grid-template-columns:1fr; }
    .right-stack { display:flex; flex-direction:column; }
  }
  @media (max-width:680px) {
    main { padding:20px 16px; }
    table { font-size:12px; }
    th, td { padding:7px 6px; }
    .controls { grid-template-columns:1fr; }
  }
</style>
</head>
<body>
<div class="layout">
  <main>
    <div class="topbar" id="overview">
      <h1>Ledger Agent Payables</h1>
      <div class="subtitle">Gateway monitor for the current policy session: signed policy, reservations, exceptions, and settlement events.</div>
    </div>
    <div class="meta-row">
      <span>Window: current policy session</span>
      <span>Auto-refresh: 1.5s</span>
      <span id="last-refresh">Last update: -</span>
    </div>

    <div class="grid kpis">
      <div class="kpi"><div class="label">Policy</div><div class="value" id="kpi-policy">-</div></div>
      <div class="kpi"><div class="label">Settled USDC</div><div class="value" id="kpi-spend">-</div></div>
      <div class="kpi"><div class="label">Open Exceptions</div><div class="value" id="kpi-pending">-</div></div>
      <div class="kpi"><div class="label">Recorded Decisions</div><div class="value" id="kpi-requests">-</div></div>
    </div>

    <div class="grid content-grid">
      <div class="left-stack">
        <section class="panel" id="policy">
          <div class="panel-head">
            <h2>Signed Policy</h2>
          </div>
          <div class="panel-body scroll-window policy-scroll">
            <div class="kv" id="authority"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Budget</h2>
          </div>
          <div class="panel-body" id="budget"></div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Request Controls</h2>
          </div>
          <div class="panel-body">
            <div class="controls" id="targets"></div>
            <div class="status-line" id="request-status"></div>
          </div>
        </section>
      </div>

      <div class="right-stack">
        <section class="panel" id="statement">
          <div class="panel-head">
            <h2>Statement</h2>
          </div>
          <div class="panel-body">
            <div class="statement-bars" id="statement-bars"></div>
            <div class="scroll-window statement-scroll">
              <table id="statement-table"></table>
            </div>
          </div>
        </section>

        <section class="panel" id="exceptions">
          <div class="panel-head">
            <h2>Exceptions</h2>
            <div class="status-line" id="approve-status"></div>
          </div>
          <div class="panel-body">
            <div class="scroll-window exceptions-scroll">
              <table id="exceptions-table"></table>
            </div>
          </div>
        </section>
      </div>
    </div>

    <section class="panel wide" id="events">
      <div class="panel-head">
        <h2>Live Decisions</h2>
      </div>
      <div class="panel-body scroll-window events-scroll">
        <table id="events-table"></table>
      </div>
    </section>
  </main>
</div>
<script>
const state = { policy: null, budget: null, events: [], exceptions: [], statement: null, targets: [] };
const fmtUsd = (atomic) => "$" + (Number(atomic || 0) / 1e6).toFixed(Number(atomic || 0) % 1e6 ? 6 : 2).replace(/0+$/,"").replace(/\\.$/,".00");
const short = (s, n = 12) => s && s.length > n ? s.slice(0, n) + "..." : (s || "");
const text = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const timeUtc = (iso) => new Date(iso).toISOString().slice(11, 19);
const pill = (d) => '<span class="pill ' + d + '">' + text(d.replace("_", " ")) + "</span>";
const networkLabel = (network) => network === "eip155:5042002" ? "Arc testnet" : network;
const signatureLabel = (type) => type === "ledger-eip191" ? "Ledger EIP-191" : type === "mock-secp256k1" ? "local test signer" : (type || "unsigned");
const compactTargetLabel = (label) => label
  .replace("Allowed payment", "Allowed")
  .replace("New vendor", "New vendor")
  .replace(" (", " ")
  .replace(")", "");
async function jget(path) { const r = await fetch(path); return r.json(); }

function activeRun() {
  return state.budget?.runs?.[0] ?? null;
}

function renderKpis() {
  const policy = state.policy?.policy;
  const settled = state.budget?.policy?.policySettled ?? 0;
  const pending = state.exceptions.filter((x) => x.status === "pending").length;
  document.getElementById("kpi-policy").textContent = policy ? "Active" : "None";
  document.getElementById("kpi-spend").textContent = fmtUsd(settled);
  document.getElementById("kpi-pending").textContent = pending;
  document.getElementById("kpi-requests").textContent = state.events.length;
}

function renderAuthority(payload) {
  const policy = payload.policy;
  if (!policy) {
    document.getElementById("authority").innerHTML = "<div><span>Status</span><span>unconfigured</span></div>";
    return;
  }
  const signature = payload.signature;
  document.getElementById("authority").innerHTML = [
    ["Agent", text(policy.agentId)],
    ["Policy", text(policy.id)],
    ["Network", text(networkLabel(policy.network))],
    ["Asset", text(policy.currency)],
    ["Signature", text(signatureLabel(signature?.signatureType))],
    ["Owner", '<span class="mono">' + text(short(policy.ownerAddress, 18)) + "</span>"],
    ["Signer", '<span class="mono">' + text(short(signature?.signer ?? "unsigned", 18)) + "</span>"],
    ["Allowed vendors", text(policy.allowedVendors.join(", "))],
    ["Per-request cap", fmtUsd(policy.maxAmountAtomic)],
    ["Daily budget", fmtUsd(policy.dailyBudgetAtomic)],
    ["Velocity", text(policy.maxRequestsPerMinute + "/min")],
    ["Expires", text(new Date(policy.expiresAt).toLocaleString())],
  ].map(([k, v]) => "<div><span>" + k + "</span><span>" + v + "</span></div>").join("");
}

function renderBudget(budget) {
  const node = document.getElementById("budget");
  if (!budget.policy) {
    node.innerHTML = "<div class='empty'>No active budget.</div>";
    return;
  }
  const rows = [["Policy daily", budget.policy.policyDailyAtomic, budget.policy.policySettled + budget.policy.policyReserved]]
    .concat(budget.runs.map((r) => [r.taskLabel || r.id, r.runBudgetAtomic, r.runSettled + r.runReserved]));
  node.innerHTML = rows.map(([label, total, used]) => {
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    return "<div class='bar-row'>" +
      "<div class='bar-meta'><span class='bar-title'>" + text(label) + "</span>" +
      "<span class='bar-amount'>" + fmtUsd(used) + " of " + fmtUsd(total) + "</span></div>" +
      "<div class='bar'><i style='width:" + pct + "%'></i></div></div>";
  }).join("");
}

function renderTargets(targets) {
  const node = document.getElementById("targets");
  const policy = state.policy?.policy;
  const run = activeRun();
  if (!targets.length) {
    node.innerHTML = "<div class='empty'>No demo targets configured.</div>";
    return;
  }
  node.innerHTML = targets.map((target, index) => {
    const cls = target.kind === "allowed" ? "btn primary" : target.kind === "unknown" ? "btn warning" : "btn";
    return "<button class='" + cls + "' " + (!policy || !run ? "disabled " : "") +
      "onclick='sendTarget(" + index + ", this)'>" + text(compactTargetLabel(target.label)) + "</button>";
  }).join("");
}

function renderEvents(events) {
  const rows = events.map((e) =>
    "<tr><td>" + text(timeUtc(e.createdAt)) + "</td>" +
    "<td>" + text(e.vendorId) + "</td><td class='mono' title=\\"" + text(e.resourceUrl) + "\\">" + text(e.resourceUrl) + "</td>" +
    "<td>" + fmtUsd(e.amountAtomic) + "</td><td>" + pill(e.decision) + "</td>" +
    "<td>" + text(e.decisionReason) + "</td><td>" + text(e.status) + "</td></tr>").join("");
  document.getElementById("events-table").innerHTML =
    "<thead><tr><th>Time (UTC)</th><th>Vendor</th><th>Resource</th><th>Amount</th><th>Decision</th><th>Reason</th><th>Status</th></tr></thead>" +
    "<tbody>" + (rows || "<tr><td colspan='7' class='empty'>No requests yet.</td></tr>") + "</tbody>";
}

function renderExceptions(exceptions) {
  const rows = exceptions.map((x) =>
    "<tr><td>" + text(x.type) + "</td><td>" + text(x.vendorId) + "</td><td>" + fmtUsd(x.amountAtomic) + "</td>" +
    "<td>" + pill(x.status === "pending" ? "needs_approval" : "approved") + "</td>" +
    "<td>" + (x.status === "pending"
      ? "<button class='btn primary' onclick=\\"approve('" + x.id + "', this)\\">Approve</button>"
      : "<span class='mono'>" + text(short(x.approverAddress ?? "", 14)) + "</span>") + "</td></tr>").join("");
  document.getElementById("exceptions-table").innerHTML =
    "<thead><tr><th>Type</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Approval</th></tr></thead>" +
    "<tbody>" + (rows || "<tr><td colspan='5' class='empty'>No exceptions.</td></tr>") + "</tbody>";
}

function renderStatement(statement) {
  const rows = statement.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => Number(r.attemptedUsd || 0)));
  document.getElementById("statement-bars").innerHTML = rows.length ? rows.map((r) => {
    const width = Math.max(4, (Number(r.attemptedUsd || 0) / max) * 100);
    return "<div class='bar-row'><div class='bar-meta'><span class='bar-title'>" + text(r.vendorId) + "</span>" +
      "<span class='bar-amount'>$" + text(r.approvedUsd) + " approved</span></div>" +
      "<div class='bar'><i style='width:" + width + "%'></i></div></div>";
  }).join("") : "<div class='empty'>No statement rows.</div>";
  document.getElementById("statement-table").innerHTML =
    "<thead><tr><th>Vendor</th><th>Decision</th><th>#</th><th>Approved</th></tr></thead>" +
    "<tbody>" + rows.map((r) => "<tr><td class='row-label'>" + text(r.vendorId) + "</td><td>" + pill(r.decision) + "</td>" +
      "<td>" + text(r.requestCount) + "</td><td>$" + text(r.approvedUsd) + "</td></tr>").join("") + "</tbody>";
}

async function sendTarget(index, button) {
  const policy = state.policy?.policy;
  const run = activeRun();
  const target = state.targets[index];
  const status = document.getElementById("request-status");
  if (!policy || !run || !target) return;
  button.disabled = true;
  status.textContent = "submitting request...";
  try {
    const response = await fetch("/guarded-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: policy.agentId,
        runId: run.id,
        resourceUrl: target.resourceUrl,
        idempotencyKey: "ui_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      }),
    });
    const body = await response.json();
    status.textContent = response.status + " · " + (body.decision || body.error) + (body.reason ? " · " + body.reason : "");
  } catch (error) {
    status.textContent = "failed · " + error.message;
  }
  button.disabled = false;
  refresh();
}

async function approve(id, button) {
  button.disabled = true;
  const status = document.getElementById("approve-status");
  try {
    status.textContent = "signing...";
    const signed = await fetch("/demo/sign-approval", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exceptionId: id }),
    });
    if (!signed.ok) throw new Error((await signed.json()).error ?? "signing unavailable");
    const { approval } = await signed.json();
    status.textContent = "executing...";
    const result = await fetch("/exceptions/" + id + "/approve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval }),
    });
    const body = await result.json();
    status.textContent = result.ok ? "approved · " + body.status : "rejected · " + (body.error ?? result.status);
  } catch (error) {
    status.textContent = "failed · " + error.message;
    button.disabled = false;
  }
  refresh();
}

async function refresh() {
  try {
    const [policy, budget, events, exceptions, statement, targets] = await Promise.all([
      jget("/policy"), jget("/budget"), jget("/events"), jget("/exceptions"), jget("/statement"), jget("/demo-targets"),
    ]);
    state.policy = policy;
    state.budget = budget;
    state.events = events.events;
    state.exceptions = exceptions.exceptions;
    state.statement = statement;
    state.targets = targets.targets ?? [];
    renderAuthority(policy);
    renderBudget(budget);
    renderTargets(state.targets);
    renderEvents(state.events);
    renderExceptions(state.exceptions);
    renderStatement(statement);
    renderKpis();
    document.getElementById("last-refresh").textContent = "Last update: " + new Date().toLocaleTimeString();
  } catch {}
}
refresh();
setInterval(refresh, 1500);
</script>
</body>
</html>`;
}
