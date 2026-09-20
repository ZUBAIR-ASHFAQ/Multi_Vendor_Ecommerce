import { z } from "zod";

const browserEnvSchema = z.object({
  VITE_API_BASE_URL: z.url(),
  VITE_APP_NAME: z.string().trim().min(1).max(80).default("Marketplace"),
  VITE_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .regex(/^pk_(?:test|live)_/, "Stripe publishable key must start with pk_test_ or pk_live_."),
});

const parsedEnv = browserEnvSchema.safeParse(import.meta.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid frontend environment: ${message}`);
}

export const env = Object.freeze(parsedEnv.data);
