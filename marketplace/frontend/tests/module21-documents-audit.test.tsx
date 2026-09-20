import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/app";
import { createTestRouter } from "@/app/router/router";
import { createQueryClient } from "@/lib/query-client";
import { setAccessToken } from "@/lib/auth-session";
import { env } from "@/lib/env";
import { server } from "./setup/msw-server";

const actorId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const linkId = "33333333-3333-4333-8333-333333333333";
const auditId = "44444444-4444-4444-8444-444444444444";

/** Creates one authenticated actor with the requested Module 21 permissions. */
function actor(permissions: string[], accountType: "platform_admin" | "seller" = "platform_admin") {
  return {
    id: actorId,
    email: "auditor@example.com",
    displayName: "Module 21 User",
    accountType,
    status: "active",
    roles: [],
    permissions,
    scopes: { sellerIds: accountType === "seller" ? ["55555555-5555-4555-8555-555555555555"] : [], storeIds: [] },
  };
}

/** Registers the current-user endpoint for one deterministic authenticated actor. */
function useActor(permissions: string[], accountType: "platform_admin" | "seller" = "platform_admin") {
  setAccessToken("module21-token");
  server.use(
    http.get(`${env.VITE_API_BASE_URL}/auth/me`, () =>
      HttpResponse.json({ success: true, data: actor(permissions, accountType) }),
    ),
  );
}

describe("Module 21 Documents & Audit UI", () => {
  it("signs, uploads, confirms, and optionally links a file without sending bytes through the API", async () => {
    useActor(["documents.upload", "documents.read", "documents.link"]);
    let signedBody: unknown;
    let linkBody: unknown;

    server.use(
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/sign`, async ({ request }) => {
        signedBody = await request.json();
        return HttpResponse.json(
          {
            success: true,
            data: {
              fileId,
              uploadUrl: "https://uploads.example.test/signed-object",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              requiredHeaders: { "Content-Type": "text/plain" },
            },
          },
          { status: 201 },
        );
      }),
      http.put("https://uploads.example.test/signed-object", () => new HttpResponse(null, { status: 200 })),
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/${fileId}/confirm`, () =>
        HttpResponse.json({
          success: true,
          data: {
            file: {
              id: fileId,
              originalName: "evidence.txt",
              mimeType: "text/plain",
              sizeBytes: 8,
              status: "confirmed",
              createdAt: new Date().toISOString(),
            },
          },
        }),
      ),
      http.post(`${env.VITE_API_BASE_URL}/documents/${fileId}/link`, async ({ request }) => {
        linkBody = await request.json();
        return HttpResponse.json(
          {
            success: true,
            data: {
              link: {
                id: linkId,
                fileId,
                resourceType: "user",
                resourceId: actorId,
                purpose: "operational_evidence",
                createdBy: actorId,
                createdAt: new Date().toISOString(),
              },
            },
          },
          { status: 201 },
        );
      }),
    );

    const router = createTestRouter(["/documents"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    const file = new File(["evidence"], "evidence.txt", { type: "text/plain" });
    await user.upload(await screen.findByLabelText("File"), file);
    await user.click(screen.getByLabelText("Link to my account"));
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect((await screen.findAllByText("evidence.txt")).length).toBeGreaterThanOrEqual(2);
    expect(signedBody).toEqual({
      originalName: "evidence.txt",
      mimeType: "text/plain",
      sizeBytes: 8,
      purpose: "operational_evidence",
    });
    expect(linkBody).toEqual({
      resourceType: "user",
      resourceId: actorId,
      purpose: "operational_evidence",
    });
  });

  it("shows a safe storage-upload error without leaving the documents page", async () => {
    useActor(["documents.upload"]);

    server.use(
      http.post(`${env.VITE_API_BASE_URL}/documents/uploads/sign`, () =>
        HttpResponse.json(
          {
            success: true,
            data: {
              fileId,
              uploadUrl: "https://uploads.example.test/failing-object",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              requiredHeaders: { "Content-Type": "text/plain" },
            },
          },
          { status: 201 },
        ),
      ),
      http.put(
        "https://uploads.example.test/failing-object",
        () => new HttpResponse(null, { status: 503 }),
      ),
    );

    const router = createTestRouter(["/documents"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    await user.upload(
      await screen.findByLabelText("File"),
      new File(["evidence"], "failed.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect(
      await screen.findByText("The file could not be uploaded to object storage."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upload a document" })).toBeInTheDocument();
  });

  it("searches audit metadata with actor filtering and opens redacted audit detail", async () => {
    useActor(["audit.read"]);
    let latestAuditUrl: URL | null = null;
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/audit`, ({ request }) => {
        latestAuditUrl = new URL(request.url);
        return HttpResponse.json({
          success: true,
          data: [
            {
              id: auditId,
              actorUserId: actorId,
              actorType: "platform_admin",
              action: "file.linked",
              resourceType: "user",
              resourceId: actorId,
              sellerId: null,
              requestId: "request-21",
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
        });
      }),
      http.get(`${env.VITE_API_BASE_URL}/audit/${auditId}`, () =>
        HttpResponse.json({
          success: true,
          data: {
            id: auditId,
            actorUserId: actorId,
            actorType: "platform_admin",
            action: "file.linked",
            resourceType: "user",
            resourceId: actorId,
            sellerId: null,
            requestId: "request-21",
            createdAt: new Date().toISOString(),
            before: null,
            after: { token: "[REDACTED]" },
          },
        }),
      ),
    );

    const router = createTestRouter(["/audit"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Audit actor user ID"), actorId);
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(latestAuditUrl?.searchParams.get("actorUserId")).toBe(actorId);
    });

    await user.click(await screen.findByRole("link", { name: "View" }));

    expect(await screen.findByRole("heading", { name: "file.linked" })).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Audit export" })).not.toBeInTheDocument();
  });

  it("does not expose a seller-id filter to seller users", async () => {
    useActor(["audit.read"], "seller");
    server.use(
      http.get(`${env.VITE_API_BASE_URL}/audit`, () =>
        HttpResponse.json({
          success: true,
          data: [],
          meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
        }),
      ),
    );

    const router = createTestRouter(["/audit"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
    expect(screen.getByLabelText("Audit actor user ID")).toBeInTheDocument();
    expect(screen.queryByLabelText("Audit seller ID")).not.toBeInTheDocument();
    expect(screen.getByText("No audit records matched the filters.")).toBeInTheDocument();
  });

  it("shows a clear permission state when the actor cannot use document workflows", async () => {
    useActor([]);

    const router = createTestRouter(["/documents"]);
    await router.load();
    render(<App router={router} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Upload a document" })).not.toBeInTheDocument();
  });
});
