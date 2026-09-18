import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const host = process.env.E2E_STRIPE_HOST ?? "127.0.0.1";
const port = Number(process.env.E2E_STRIPE_PORT ?? "4123");
const paymentIntents = new Map();
const refunds = new Map();
const paymentIntentIdempotency = new Map();
const refundIdempotency = new Map();

/** Writes one JSON response using Stripe-like error/status semantics. */
function json(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Reads the complete small request body used by the local provider-test server. */
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Converts Stripe form-encoded metadata fields into one plain object. */
function readMetadata(form) {
  return {
    paymentId: form.get("metadata[paymentId]") ?? "",
    orderId: form.get("metadata[orderId]") ?? "",
  };
}

/** Returns one Stripe-shaped PaymentIntent response safe for SDK normalization tests. */
function createPaymentIntent(form) {
  const id = `pi_e2e_${randomUUID().replaceAll("-", "")}`;
  const amount = Number(form.get("amount") ?? "0");
  const currency = String(form.get("currency") ?? "usd").toLowerCase();
  const intent = {
    id,
    object: "payment_intent",
    amount,
    amount_received: 0,
    currency,
    capture_method: "automatic",
    status: "requires_payment_method",
    client_secret: `${id}_secret_e2e`,
    created: Math.floor(Date.now() / 1000),
    latest_charge: null,
    metadata: readMetadata(form),
  };
  paymentIntents.set(id, intent);
  return intent;
}

/** Marks one local PaymentIntent as provider-authoritatively captured. */
function succeedPaymentIntent(intent) {
  const captured = {
    ...intent,
    status: "succeeded",
    amount_received: intent.amount,
    latest_charge: `ch_e2e_${randomUUID().replaceAll("-", "")}`,
    client_secret: intent.client_secret,
  };
  paymentIntents.set(intent.id, captured);
  return captured;
}

/** Marks one local PaymentIntent as cancelled without inventing captured money. */
function cancelPaymentIntent(intent) {
  const cancelled = { ...intent, status: "canceled", amount_received: 0, latest_charge: null };
  paymentIntents.set(intent.id, cancelled);
  return cancelled;
}

/** Creates one Stripe-shaped successful Refund tied to its PaymentIntent. */
function createRefund(form) {
  const paymentIntentId = String(form.get("payment_intent") ?? "");
  const intent = paymentIntents.get(paymentIntentId);
  if (!intent) return null;

  const id = `re_e2e_${randomUUID().replaceAll("-", "")}`;
  const refund = {
    id,
    object: "refund",
    amount: Number(form.get("amount") ?? "0"),
    currency: intent.currency,
    payment_intent: paymentIntentId,
    status: "succeeded",
    created: Math.floor(Date.now() / 1000),
  };
  refunds.set(id, refund);
  return refund;
}

/** Routes the tiny Stripe-compatible surface needed by Module 12 release E2E. */
async function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/v1/payment_intents") {
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    const existingId = idempotencyKey ? paymentIntentIdempotency.get(idempotencyKey) : undefined;
    if (existingId && paymentIntents.has(existingId)) return json(response, 200, paymentIntents.get(existingId));

    const form = new URLSearchParams(await readBody(request));
    const intent = createPaymentIntent(form);
    if (idempotencyKey) paymentIntentIdempotency.set(idempotencyKey, intent.id);
    return json(response, 200, intent);
  }

  const paymentIntentMatch = url.pathname.match(/^\/v1\/payment_intents\/([^/]+)$/);
  if (request.method === "GET" && paymentIntentMatch) {
    const intent = paymentIntents.get(paymentIntentMatch[1]);
    return intent ? json(response, 200, intent) : json(response, 404, { error: { message: "PaymentIntent not found" } });
  }

  const cancelMatch = url.pathname.match(/^\/v1\/payment_intents\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const intent = paymentIntents.get(cancelMatch[1]);
    return intent
      ? json(response, 200, cancelPaymentIntent(intent))
      : json(response, 404, { error: { message: "PaymentIntent not found" } });
  }

  if (request.method === "POST" && url.pathname === "/v1/refunds") {
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    const existingId = idempotencyKey ? refundIdempotency.get(idempotencyKey) : undefined;
    if (existingId && refunds.has(existingId)) return json(response, 200, refunds.get(existingId));

    const form = new URLSearchParams(await readBody(request));
    const refund = createRefund(form);
    if (!refund) return json(response, 404, { error: { message: "PaymentIntent not found" } });
    if (idempotencyKey) refundIdempotency.set(idempotencyKey, refund.id);
    return json(response, 200, refund);
  }

  const refundMatch = url.pathname.match(/^\/v1\/refunds\/([^/]+)$/);
  if (request.method === "GET" && refundMatch) {
    const refund = refunds.get(refundMatch[1]);
    return refund ? json(response, 200, refund) : json(response, 404, { error: { message: "Refund not found" } });
  }

  const succeedMatch = url.pathname.match(/^\/__e2e\/payment_intents\/([^/]+)\/succeed$/);
  if (request.method === "POST" && succeedMatch) {
    const intent = paymentIntents.get(succeedMatch[1]);
    return intent
      ? json(response, 200, succeedPaymentIntent(intent))
      : json(response, 404, { error: { message: "PaymentIntent not found" } });
  }

  const fixtureMatch = url.pathname.match(/^\/__e2e\/payment_intents\/([^/]+)$/);
  if (request.method === "GET" && fixtureMatch) {
    const intent = paymentIntents.get(fixtureMatch[1]);
    return intent ? json(response, 200, intent) : json(response, 404, { error: { message: "PaymentIntent not found" } });
  }

  return json(response, 404, { error: { message: "Unknown provider-test endpoint" } });
}

/** Delegates one Node HTTP request to the small provider-test router and returns safe errors. */
function handleServerRequest(request, response) {
  void handle(request, response).catch((error) => {
    console.error("Fake Stripe provider-test server error:", error);
    json(response, 500, { error: { message: "Provider-test server failed" } });
  });
}

const server = createServer(handleServerRequest);

/** Closes the provider-test process cleanly when the E2E runner stops it. */
function shutdown() {
  server.close(() => process.exit(0));
}

/** Prints the local provider-test endpoint once the server is ready. */
function announceServerStarted() {
  console.log(`Fake Stripe provider-test server listening on http://${host}:${port}`);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
server.listen(port, host, announceServerStarted);
