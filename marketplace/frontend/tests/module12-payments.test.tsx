import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { vi } from "vitest";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { PaymentElementForm } from "@/features/payments/forms/payment-element-form";
import { paymentsApi } from "@/features/payments/api/payments.api";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { createQueryClient } from "@/lib/query-client";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const stripeMocks = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: ReactNode }) => children,
  PaymentElement: () => <div data-testid="stripe-payment-element">Stripe Payment Element</div>,
  useStripe: () => ({ confirmPayment: stripeMocks.confirmPayment }),
  useElements: () => ({ id: "mock-elements" }),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));

const customerId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";
const now = "2026-09-14T06:00:00.000Z";

/** Clears the synthetic session used by focused Module 12 frontend tests. */
afterEach(() => clearAccessToken());

/** Builds one deterministic customer or platform actor for Payments UI tests. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: customerId,
    email: `${accountType}@example.test`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Registers the standard authenticated actor response used by protected Payment pages. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module12-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-payments" }),
    ),
  );
}

/** Builds one customer-safe provider-authoritative Payment response. */
function customerPayment(status: "pending" | "processing" | "captured" = "processing") {
  return {
    paymentId,
    orderId,
    provider: "stripe" as const,
    status,
    currency: "USD",
    amountAuthorized: "125.0000",
    amountCaptured: status === "captured" ? "125.0000" : "0.0000",
    amountRefunded: "0.0000",
    refundableAmount: status === "captured" ? "125.0000" : "0.0000",
    providerPaymentId: "pi_module12_test",
    paymentExpiresAt: "2026-09-14T06:15:00.000Z",
    createdAt: now,
    updatedAt: now,
  };
}

/** Builds one finance Payment list/detail representation. */
function adminPayment() {
  const payment = customerPayment("captured");
  return {
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    provider: payment.provider,
    status: payment.status,
    currency: payment.currency,
    amountAuthorized: payment.amountAuthorized,
    amountCaptured: payment.amountCaptured,
    amountRefunded: payment.amountRefunded,
    refundableAmount: payment.refundableAmount,
    providerPaymentId: payment.providerPaymentId,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/** Renders one real application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

describe("Module 12 Payments UI", () => {
  it("shows processing from the marketplace API even when the Stripe redirect query says succeeded", async () => {
    useActor(actor("customer", ["payments.read_own"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/payments/order/${orderId}`, () =>
        HttpResponse.json({ success: true, data: customerPayment("processing"), requestId: "req-payment-status" }),
      ),
    );

    await renderRoute(`/payments/orders/${orderId}?redirect_status=succeeded`);

    expect(await screen.findByRole("heading", { name: "Payment status" })).toBeInTheDocument();
    expect(screen.getByText(/Payment is still processing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Payment captured\. The marketplace received/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Browser redirect parameters never mark an Order paid/i)).toBeInTheDocument();
  });

  it("blocks customer Payment reads before the API call when payments.read_own is missing", async () => {
    useActor(actor("customer", []));
    let paymentCalls = 0;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/payments/order/${orderId}`, () => {
        paymentCalls += 1;
        return HttpResponse.json({ success: true, data: customerPayment(), requestId: "unexpected-payment" });
      }),
    );

    await renderRoute(`/payments/orders/${orderId}`);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(paymentCalls).toBe(0);
  });

  it("searches finance Payments with TanStack Form filters and only documented query fields", async () => {
    useActor(actor("platform_admin", ["admin.payments.read"]));
    let requestedUrl = "";
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/payments`, ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({
          success: true,
          data: [adminPayment()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-admin-payments",
        });
      }),
    );

    await renderRoute("/admin/payments");
    expect(await screen.findByRole("heading", { name: "Payment search" })).toBeInTheDocument();
    expect(screen.getByText("pi_module12_test")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Payment status filter"), "captured");
    await user.type(screen.getByLabelText("Payment Order UUID"), orderId);
    await user.type(screen.getByLabelText("Payment currency filter"), "usd");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      const url = new URL(requestedUrl);
      expect(url.searchParams.get("status")).toBe("captured");
      expect(url.searchParams.get("orderId")).toBe(orderId);
      expect(url.searchParams.get("currency")).toBe("USD");
    });
  });

  it("renders the finance transaction timeline and refund provider reference without a refund button", async () => {
    useActor(actor("platform_admin", ["admin.payments.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/payments/${paymentId}`, () =>
        HttpResponse.json({
          success: true,
          data: {
            ...adminPayment(),
            amountRefunded: "25.0000",
            refundableAmount: "100.0000",
            status: "partially_refunded",
            transactions: [
              {
                id: transactionId,
                type: "refund",
                providerTxnId: "re_module12_test",
                amount: "25.0000",
                status: "succeeded",
                occurredAt: now,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          requestId: "req-admin-payment-detail",
        }),
      ),
    );

    await renderRoute(`/admin/payments/${paymentId}`);

    expect(await screen.findByRole("heading", { name: "Transaction timeline" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Payment transaction timeline" })).toHaveTextContent("Refund reference:");
    expect(screen.getByText("re_module12_test")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
  });

  it("creates the PaymentIntent with a retry key and lets Stripe.js handle card confirmation", async () => {
    setAccessToken("module12-frontend-token");
    let requestBody: unknown = null;
    let retryKey = "";
    server.use(
      http.post(`${env.VITE_API_BASE_URL}/payments/order/${orderId}/intent`, async ({ request }) => {
        requestBody = await request.json();
        retryKey = request.headers.get("Idempotency-Key") ?? "";
        return HttpResponse.json({
          success: true,
          data: {
            paymentId,
            orderId,
            provider: "stripe",
            providerPaymentId: "pi_module12_test",
            status: "pending",
            currency: "USD",
            amount: "125.0000",
            paymentExpiresAt: "2026-09-14T06:15:00.000Z",
            clientSecret: "pi_secret_browser_only",
          },
          requestId: "req-payment-intent",
        });
      }),
    );

    const intent = await paymentsApi.createIntent(orderId, "browser-retry-key");
    expect(intent.clientSecret).toBe("pi_secret_browser_only");
    expect(requestBody).toEqual({});
    expect(retryKey).toBe("browser-retry-key");

    stripeMocks.confirmPayment.mockResolvedValue({});
    const onProcessing = vi.fn();
    render(<PaymentElementForm orderId={orderId} onProcessing={onProcessing} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Pay securely" }));

    await waitFor(() => expect(stripeMocks.confirmPayment).toHaveBeenCalledTimes(1));
    expect(stripeMocks.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/payments/orders/${orderId}`,
        },
      }),
    );
    expect(onProcessing).toHaveBeenCalledTimes(1);
  });
});
