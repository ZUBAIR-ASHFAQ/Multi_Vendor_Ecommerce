import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { OrdersController } from "../../src/modules/orders/orders.controller.js";
import type { OrdersService } from "../../src/modules/orders/orders.service.js";

/** Creates a minimal response stub that preserves request context and captures JSON output. */
function responseStub() {
  const response = {
    locals: {
      requestId: randomUUID(),
      requestContext: {
        actorId: randomUUID(),
        actorType: "user",
        roles: [],
        permissions: ["orders.read_own"],
        sellerIds: [],
        storeIds: [],
        requestId: randomUUID(),
      },
    },
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  vi.mocked(response.status).mockReturnValue(response);
  return response;
}

/** Creates the small service surface needed by the focused controller tests. */
function serviceStub(overrides: Partial<OrdersService> = {}): OrdersService {
  return {
    listCustomerOrders: vi.fn(),
    getCustomerOrder: vi.fn(),
    listSellerOrders: vi.fn(),
    getSellerOrder: vi.fn(),
    acceptSellerOrder: vi.fn(),
    cancelCustomerOrder: vi.fn(),
    cancelAdminOrder: vi.fn(),
    listAdminOrders: vi.fn(),
    confirmPayment: vi.fn(),
    ...overrides,
  } as unknown as OrdersService;
}

describe("Module 11 Orders HTTP adapter", () => {
  it("parses customer list query and keeps pagination meta in the standard envelope", async () => {
    const listCustomerOrders = vi.fn().mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
    const controller = new OrdersController(serviceStub({ listCustomerOrders }));
    const request = { query: {} } as Request;
    const response = responseStub();
    const next = vi.fn() as NextFunction;

    await controller.listCustomerOrders(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(listCustomerOrders).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: [],
        meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      }),
    );
  });

  it("requires and forwards the validated Idempotency-Key for customer cancellation", async () => {
    const orderId = randomUUID();
    const cancelCustomerOrder = vi.fn().mockResolvedValue({ id: orderId });
    const controller = new OrdersController(serviceStub({ cancelCustomerOrder }));
    const request = {
      params: { id: orderId },
      body: { reason: "Changed my mind" },
      headers: { "idempotency-key": "cancel-order-1" },
    } as unknown as Request;
    const response = responseStub();
    const next = vi.fn() as NextFunction;

    await controller.cancelCustomerOrder(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(cancelCustomerOrder).toHaveBeenCalledWith(
      expect.any(Object),
      orderId,
      { reason: "Changed my mind" },
      "cancel-order-1",
    );
  });

  it("accepts a missing request body for the strict empty seller acceptance command", async () => {
    const sellerOrderId = randomUUID();
    const acceptSellerOrder = vi.fn().mockResolvedValue({ id: sellerOrderId });
    const controller = new OrdersController(serviceStub({ acceptSellerOrder }));
    const request = { params: { id: sellerOrderId }, body: undefined } as unknown as Request;
    const response = responseStub();
    const next = vi.fn() as NextFunction;

    await controller.acceptSellerOrder(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(acceptSellerOrder).toHaveBeenCalledWith(expect.any(Object), sellerOrderId);
  });
});
