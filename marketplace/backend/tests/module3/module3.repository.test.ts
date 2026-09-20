import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "../../src/database/db.js";
import { CustomersRepository } from "../../src/modules/customers/customers.repository.js";
import {
  registerCustomer,
  resetModule3Tables,
} from "./module3.test-helpers.js";

beforeEach(async () => {
  await resetModule3Tables();
});

afterAll(async () => {
  await closeDatabase();
});

describe("Module 3 repository customer scope", () => {
  it("keeps saved-address reads and mutations inside the exact customer owner scope", async () => {
    const customerA = await registerCustomer(
      `module3-repo-a-${randomUUID()}@example.com`,
      "Repository Customer A",
    );
    const customerB = await registerCustomer(
      `module3-repo-b-${randomUUID()}@example.com`,
      "Repository Customer B",
    );
    const repository = new CustomersRepository();

    const addressA = await repository.createAddress({
      customerUserId: customerA.id,
      label: "Home",
      recipientName: "Customer A",
      phone: "+923001111111",
      line1: "1 Repository Street",
      city: "Karachi",
      region: "Sindh",
      countryCode: "PK",
      isDefaultShipping: false,
      isDefaultBilling: false,
    });
    await repository.createAddress({
      customerUserId: customerB.id,
      label: "Home",
      recipientName: "Customer B",
      phone: "+923002222222",
      line1: "2 Repository Street",
      city: "Lahore",
      region: "Punjab",
      countryCode: "PK",
      isDefaultShipping: false,
      isDefaultBilling: false,
    });

    await expect(
      repository.findAddressByIdForCustomer(addressA.id, customerB.id),
    ).resolves.toBeNull();
    await expect(
      repository.updateAddressForCustomer(addressA.id, customerB.id, {
        label: "Foreign",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.archiveAddressForCustomer(addressA.id, customerB.id),
    ).resolves.toBeNull();

    await expect(repository.listAddressesByCustomerUserId(customerA.id)).resolves.toEqual([
      expect.objectContaining({ id: addressA.id, customerUserId: customerA.id }),
    ]);
    await expect(
      repository.updateAddressForCustomer(addressA.id, customerA.id, {
        label: "Primary Home",
      }),
    ).resolves.toMatchObject({ id: addressA.id, label: "Primary Home" });
  });
});
