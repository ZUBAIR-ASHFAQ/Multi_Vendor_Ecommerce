import { describe, expect, it, vi } from "vitest";
import {
  LIFECYCLE_MAINTENANCE_JOB,
  runLifecycleMaintenanceJob,
  type LifecycleMaintenanceProcessor,
} from "../../src/common/jobs/lifecycle-maintenance.runtime.js";

/** Builds a small maintenance processor double so job dispatch can be tested without Redis. */
function maintenanceProcessor(): LifecycleMaintenanceProcessor {
  return {
    cleanupExpiredIdempotencyKeys: vi.fn().mockResolvedValue(3),
    releaseExpiredInventoryReservations: vi.fn().mockResolvedValue(2),
  };
}

describe("Foundation lifecycle-maintenance job dispatch", () => {
  it("dispatches idempotency cleanup with the bounded maintenance batch size", async () => {
    const processor = maintenanceProcessor();

    await expect(
      runLifecycleMaintenanceJob(LIFECYCLE_MAINTENANCE_JOB.IDEMPOTENCY_CLEANUP, processor),
    ).resolves.toBe(3);

    expect(processor.cleanupExpiredIdempotencyKeys).toHaveBeenCalledWith(100);
    expect(processor.releaseExpiredInventoryReservations).not.toHaveBeenCalled();
  });

  it("dispatches Inventory reservation expiry with the bounded maintenance batch size", async () => {
    const processor = maintenanceProcessor();

    await expect(
      runLifecycleMaintenanceJob(
        LIFECYCLE_MAINTENANCE_JOB.INVENTORY_RESERVATION_EXPIRY,
        processor,
      ),
    ).resolves.toBe(2);

    expect(processor.releaseExpiredInventoryReservations).toHaveBeenCalledWith(100);
    expect(processor.cleanupExpiredIdempotencyKeys).not.toHaveBeenCalled();
  });
});
