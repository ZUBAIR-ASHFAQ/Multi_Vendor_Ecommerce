import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/u, "");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} is missing: ${expected}`);
  }
}

function forbidText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label} must not contain: ${forbidden}`);
  }
}

const launcher = read("START_MARKETPLACE.ps1");
const backendEnv = read("backend/.env.example");
const frontendEnv = read("frontend/.env.example");
const browserEnv = read("frontend/src/lib/env.ts");
const payoutForm = read("frontend/src/features/seller-wallet-payouts/forms/payout-account.form.tsx");

requireText(launcher, '$env:NOTIFICATION_EMAIL_PROVIDER_MODE =\n    "deterministic_test"', "Local deterministic notification mode");
requireText(launcher, '$env:PAYOUT_PROVIDER_MODE =\n    "deterministic_test"', "Local deterministic payout mode");
requireText(launcher, '$env:PAYOUT_PROVIDER_TYPE =\n    "local_dev"', "Local deterministic payout type");
requireText(launcher, '$env:VITE_LOCAL_DEMO_PROVIDERS =\n    "true"', "Browser local-provider signal");
requireText(launcher, "Remove-Item Env:PAYOUT_PROVIDER_ADAPTER_MODULE", "Stale payout module cleanup");
forbidText(launcher, "sk_test_local_development_placeholder", "Local launcher");
forbidText(launcher, "pk_test_local_development_placeholder", "Local launcher");
forbidText(launcher, "$env:STRIPE_API_BASE_URL", "Interactive local launcher");

requireText(backendEnv, "paid:demo_account", "Backend local payout instructions");
requireText(frontendEnv, "VITE_LOCAL_DEMO_PROVIDERS=false", "Frontend demo-provider default");
requireText(browserEnv, "VITE_LOCAL_DEMO_PROVIDERS", "Frontend environment schema");
requireText(payoutForm, "env.VITE_LOCAL_DEMO_PROVIDERS", "Local payout-account UI guidance");
requireText(payoutForm, "unknown_then_paid:demo_account", "Local payout reconciliation guidance");

console.log("Local development provider-mode verification passed.");
