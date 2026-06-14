// Long-running mock server for local console work. No real funds move.
import { createGatewayServer } from "../core/gateway.mjs";
import { usd } from "../core/money.mjs";

const PORT = Number(process.env.PORT ?? 4020);

const resources = new Map([
  ["/vendor/weather/paid/current", { vendorId: "weather", amountAtomic: usd(0.001), content: "Current weather result (mock rail)." }],
  ["/vendor/weather/paid/expensive", { vendorId: "weather", amountAtomic: usd(0.1), content: "Expensive weather report (mock rail)." }],
  ["/vendor/market/paid/quote", { vendorId: "market", amountAtomic: usd(0.01), content: "Market quote from a vendor outside the allowlist (mock rail)." }],
]);

const demoTargets = [
  { label: "Allowed payment ($0.001)", resourceUrl: "/vendor/weather/paid/current", kind: "allowed" },
  { label: "Over-cap ($0.10)", resourceUrl: "/vendor/weather/paid/expensive", kind: "overcap" },
  { label: "New vendor ($0.01)", resourceUrl: "/vendor/market/paid/quote", kind: "unknown" },
];

const { server } = createGatewayServer({ resources, demoTargets });

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Gateway listening on http://127.0.0.1:${PORT}`);
  console.log("Mock rail active. Allowed vendor: weather.");
});
