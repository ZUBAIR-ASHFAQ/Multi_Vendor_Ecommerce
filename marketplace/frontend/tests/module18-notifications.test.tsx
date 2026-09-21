import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import type { AuthenticatedUser } from "@/features/auth/types/auth.types";
import { clearAccessToken, setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { createQueryClient } from "@/lib/query-client";
import { server } from "./setup/msw-server";

const userId = "11111111-1111-4111-8111-111111111111";
const notificationId = "22222222-2222-4222-8222-222222222222";
const deliveryId = "33333333-3333-4333-8333-333333333333";
const now = "2026-09-16T09:00:00.000Z";

/** Clears the in-memory token after every isolated Module 18 frontend test. */
afterEach(() => clearAccessToken());

/** Builds one authenticated actor with only the permissions needed by the test. */
function actor(accountType: AuthenticatedUser["accountType"], permissions: string[]): AuthenticatedUser {
  return {
    id: userId,
    email: `${accountType}@example.com`,
    displayName: `${accountType} user`,
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: [], storeIds: [] },
  };
}

/** Registers one authenticated actor for the shared /auth/me query. */
function useActor(value: AuthenticatedUser): void {
  setAccessToken("module18-frontend-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: value, requestId: "req-auth-notifications" }),
    ),
  );
}

/** Renders one application route with an isolated TanStack Query cache. */
async function renderRoute(path: string): Promise<void> {
  const router = createTestRouter([path]);
  await router.load();
  render(<App router={router} queryClient={createQueryClient()} />);
}

/** Builds one safe in-app Notification response. */
function notification(readAt: string | null = null) {
  return {
    id: notificationId,
    type: "order.created",
    title: "Order received",
    body: "Your order has been received.",
    data: { orderNo: "ORD-1001" },
    readAt,
    createdAt: now,
  };
}

/** Builds one privacy-safe failed delivery admin row. */
function failedDelivery() {
  return {
    id: deliveryId,
    notificationId,
    userId,
    channel: "email",
    templateCode: "order.created.customer",
    destinationMasked: "c***@example.com",
    status: "failed",
    attempts: 3,
    providerRef: null,
    lastErrorCode: "EMAIL_PROVIDER_DELIVERY_FAILED",
    createdAt: now,
    updatedAt: now,
  };
}

describe("Module 18 Notifications React feature", () => {
  it("renders the bell unread count, owned list, mark-one-read, and mark-all-read commands", async () => {
    useActor(actor("customer", ["notifications.read_own"]));
    let unreadCount = 2;
    let readAt: string | null = null;
    let markReadCalls = 0;
    let markAllCalls = 0;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/notifications`, () =>
        HttpResponse.json({
          success: true,
          data: [notification(readAt)],
          meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, unreadCount },
          requestId: "req-notification-list",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/notifications/${notificationId}/read`, () => {
        markReadCalls += 1;
        readAt = now;
        unreadCount = 1;
        return HttpResponse.json({
          success: true,
          data: { id: notificationId, readAt: now },
          requestId: "req-notification-read",
        });
      }),
      http.post(`${env.VITE_API_BASE_URL}/notifications/read-all`, () => {
        markAllCalls += 1;
        readAt = now;
        unreadCount = 0;
        return HttpResponse.json({
          success: true,
          data: { updatedCount: 1 },
          requestId: "req-notification-read-all",
        });
      }),
    );

    await renderRoute("/notifications");
    expect(await screen.findByRole("heading", { name: "Your notifications" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Notifications, 2 unread")).toBeInTheDocument();
    expect(screen.getByText("Order received")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(markReadCalls).toBe(1));
    expect(await screen.findByText("1 unread across your account.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(markAllCalls).toBe(1));
    expect(await screen.findByText("0 unread across your account.")).toBeInTheDocument();
  });

  it("uses TanStack Form/Zod to replace editable preferences without sending user identity", async () => {
    useActor(actor("customer", ["notifications.preferences.manage_own"]));
    let updateBody: Record<string, unknown> | null = null;

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/notifications/preferences`, () =>
        HttpResponse.json({
          success: true,
          data: [{ eventCode: "order.created", channel: "email", enabled: true }],
          requestId: "req-notification-preferences",
        }),
      ),
      http.put(`${env.VITE_API_BASE_URL}/notifications/preferences`, async ({ request }) => {
        updateBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: [{ eventCode: "order.created", channel: "email", enabled: false }],
          requestId: "req-notification-preferences-update",
        });
      }),
    );

    await renderRoute("/notifications/preferences");
    expect(await screen.findByRole("heading", { name: "Notification preferences" })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.selectOptions(screen.getByLabelText("Notification preference enabled"), "disabled");
    await user.click(screen.getByRole("button", { name: "Update preference" }));

    await waitFor(() => expect(updateBody).toEqual({
      preferences: [{ eventCode: "order.created", channel: "email", enabled: false }],
    }));
    expect(updateBody).not.toHaveProperty("userId");
  });

  it("renders only masked failed-delivery data and retries through the explicit admin command", async () => {
    useActor(actor("platform_admin", ["admin.notifications.read", "admin.notifications.retry"]));
    let retryCalls = 0;
    let failedItems = [failedDelivery()];

    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/notification-deliveries`, () =>
        HttpResponse.json({
          success: true,
          data: failedItems,
          meta: { page: 1, pageSize: 20, totalItems: failedItems.length, totalPages: failedItems.length ? 1 : 0 },
          requestId: "req-notification-failures",
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/admin/notification-deliveries/${deliveryId}/retry`, () => {
        retryCalls += 1;
        failedItems = [];
        return HttpResponse.json({
          success: true,
          data: { ...failedDelivery(), status: "queued", providerRef: null, lastErrorCode: null },
          requestId: "req-notification-retry",
        });
      }),
    );

    await renderRoute("/admin/notification-deliveries");
    expect(await screen.findByRole("heading", { name: "Failed delivery queue" })).toBeInTheDocument();
    expect(screen.getByText("c***@example.com", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("platform_admin@example.com")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retryCalls).toBe(1));
    expect(await screen.findByRole("heading", { name: "No failed notification deliveries" })).toBeInTheDocument();
  });

  it("hides the privileged retry command when the admin only has delivery-read permission", async () => {
    useActor(actor("platform_admin", ["admin.notifications.read"]));
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/admin/notification-deliveries`, () =>
        HttpResponse.json({
          success: true,
          data: [failedDelivery()],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          requestId: "req-notification-failures-read-only",
        }),
      ),
    );

    await renderRoute("/admin/notification-deliveries");
    expect(await screen.findByText("c***@example.com", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
