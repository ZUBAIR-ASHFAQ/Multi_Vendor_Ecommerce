import pino, { type DestinationStream, type LoggerOptions } from "pino";
import { env } from "../../config/env.js";

const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers.x-internal-api-key",
  "req.headers.stripe-signature",
  "req.headers.idempotency-key",
  "request.headers.authorization",
  "request.headers.cookie",
  "request.headers.x-internal-api-key",
  "request.headers.stripe-signature",
  "request.headers.idempotency-key",
  "headers.authorization",
  "headers.cookie",
  "headers.x-internal-api-key",
  "headers.stripe-signature",
  "headers.idempotency-key",
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "token",
  "secret",
  "clientSecret",
  "client_secret",
  "stripeSignature",
  "stripeSecretKey",
  "stripeWebhookSecret",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "idempotencyKey",
  "apiKey",
  "accessKeyId",
  "secretAccessKey",
  "cardNumber",
  "cvv",
  "cvc",
  "bankAccount",
  "accountNumber",
  "routingNumber",
  "iban",
  "swift",
  "bic",
  "payoutCredential",
  "credentials.accessKeyId",
  "credentials.secretAccessKey",
  "payment.cardNumber",
  "payment.cvv",
  "payment.cvc",
  "payout.bankAccount",
  "payout.accountNumber",
  "payout.routingNumber",
  "payout.iban",
  "payout.swift",
  "payout.bic",
  "payout.credentials",
  "authorization",
  "cookie",
] as const;

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    service: env.SERVICE_NAME,
    environment: env.NODE_ENV,
  },
  redact: {
    paths: [...REDACTED_PATHS],
    censor: "[REDACTED]",
  },
};

/** Creates a configured logger; destination injection is used only by tests/tools. */
export function createLogger(destination?: DestinationStream) {
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

/** Application logger shared by HTTP and infrastructure services. */
export const logger = createLogger();

