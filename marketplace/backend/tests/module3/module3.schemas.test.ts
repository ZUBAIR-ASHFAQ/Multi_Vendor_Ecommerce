import { describe, expect, it } from "vitest";
import {
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  createCustomerAddressBodySchema,
  customerAddressIdParamsSchema,
  updateCustomerProfileBodySchema,
} from "../../src/modules/customers/customers.schema.js";

/** Returns a complete valid address payload so each schema test changes only the field it cares about. */
function validAddress() {
  return {
    label: "Home",
    recipientName: "Customer One",
    phone: "+92 300 1234567",
    line1: "123 Main Street",
    city: "Lahore",
    region: " Punjab  Central ",
    postalCode: "54000",
    countryCode: "pk",
  };
}

describe("Module 3 Zod contracts", () => {
  it("normalizes country and region values while keeping ownership server-controlled", () => {
    const parsed = createCustomerAddressBodySchema.parse(validAddress());

    expect(parsed.countryCode).toBe("PK");
    expect(parsed.region).toBe("Punjab Central");
    expect(parsed.isDefaultShipping).toBe(false);
    expect(parsed.isDefaultBilling).toBe(false);

    expect(() =>
      createCustomerAddressBodySchema.parse({
        ...validAddress(),
        customerUserId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toThrow();
  });

  it("rejects invalid UUID params and invalid country codes", () => {
    expect(() => customerAddressIdParamsSchema.parse({ id: "not-a-uuid" })).toThrow();
    expect(() => adminCustomerIdParamsSchema.parse({ id: "not-a-uuid" })).toThrow();
    expect(() =>
      createCustomerAddressBodySchema.parse({ ...validAddress(), countryCode: "Pakistan" }),
    ).toThrow();
  });

  it("requires at least one editable profile field and rejects authority fields", () => {
    expect(() => updateCustomerProfileBodySchema.parse({})).toThrow();
    expect(() =>
      updateCustomerProfileBodySchema.parse({
        displayName: "Customer One",
        status: "inactive",
      }),
    ).toThrow();
  });

  it("bounds admin pagination and accepts only allow-listed sorts", () => {
    const defaults = adminCustomerListQuerySchema.parse({});
    expect(defaults.page).toBe(1);
    expect(defaults.pageSize).toBeGreaterThan(0);

    expect(() => adminCustomerListQuerySchema.parse({ page: 0 })).toThrow();
    expect(() => adminCustomerListQuerySchema.parse({ pageSize: 10_000 })).toThrow();
    expect(() => adminCustomerListQuerySchema.parse({ sort: "email_desc" })).toThrow();
  });
});
