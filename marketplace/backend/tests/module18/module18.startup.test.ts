import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appListen: vi.fn(),
  checkDatabaseConnection: vi.fn(),
  closeDatabase: vi.fn(),
  connectRedis: vi.fn(),
  closeRedis: vi.fn(),
  startSearchDiscoveryRuntime: vi.fn(),
  startPaymentsRuntime: vi.fn(),
  startSellerWalletPayoutsRuntime: vi.fn(),
  startNotificationsRuntime: vi.fn(),
  startReportsRuntime: vi.fn(),
  startOutboxRuntime: vi.fn(),
  startLifecycleMaintenanceRuntime: vi.fn(),
  searchClose: vi.fn(),
  paymentsClose: vi.fn(),
  walletClose: vi.fn(),
  notificationsClose: vi.fn(),
  reportsClose: vi.fn(),
  outboxClose: vi.fn(),
  lifecycleClose: vi.fn(),
}));

vi.mock("../../src/app.js", () => ({
  app: { listen: mocks.appListen },
  inventoryService: { releaseExpiredReservations: vi.fn() },
  notificationsService: {},
  reportsService: {},
  paymentsService: {},
  searchDiscoveryService: {},
  sellerWalletPayoutsService: {},
}));

vi.mock("../../src/config/env.js", () => ({
  env: { HOST: "127.0.0.1", PORT: 3999 },
}));

vi.mock("../../src/common/idempotency/idempotency.service.js", () => ({
  IdempotencyService: class {
    /** Test double for lifecycle cleanup; startup-failure tests never call it. */
    async cleanupExpiredIdempotencyKeys() {
      return 0;
    }
  },
}));

vi.mock("../../src/common/jobs/lifecycle-maintenance.runtime.js", () => ({
  startLifecycleMaintenanceRuntime: mocks.startLifecycleMaintenanceRuntime,
}));

vi.mock("../../src/common/logger/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("../../src/common/redis/redis.client.js", () => ({
  connectRedis: mocks.connectRedis,
  closeRedis: mocks.closeRedis,
}));

vi.mock("../../src/common/outbox/outbox-worker.js", () => ({
  startOutboxRuntime: mocks.startOutboxRuntime,
}));

vi.mock("../../src/database/db.js", () => ({
  db: {},
  checkDatabaseConnection: mocks.checkDatabaseConnection,
  closeDatabase: mocks.closeDatabase,
}));

vi.mock("../../src/modules/search-discovery/index.js", () => ({
  SEARCH_JOB: { SOURCE_EVENT_QUEUE: "search-source-events" },
  startSearchDiscoveryRuntime: mocks.startSearchDiscoveryRuntime,
}));

vi.mock("../../src/modules/payments/index.js", () => ({
  startPaymentsRuntime: mocks.startPaymentsRuntime,
}));

vi.mock("../../src/modules/seller-wallet-payouts/index.js", () => ({
  WALLET_PAYOUT_JOB: { SOURCE_EVENT_QUEUE: "wallet-source-events" },
  startSellerWalletPayoutsRuntime: mocks.startSellerWalletPayoutsRuntime,
}));

vi.mock("../../src/modules/notifications/index.js", () => ({
  NOTIFICATIONS_JOB: { SOURCE_EVENT_QUEUE: "notification-source-events" },
  startNotificationsRuntime: mocks.startNotificationsRuntime,
}));

vi.mock("../../src/modules/reports/index.js", () => ({
  REPORTS_JOB: { SOURCE_EVENT_QUEUE: "reports-source-events" },
  startReportsRuntime: mocks.startReportsRuntime,
}));

import { startServer } from "../../src/server.js";

/** Restores successful dependency/runtime defaults before one startup-failure scenario is customized. */
function configureSuccessfulStartupDependencies(): void {
  mocks.checkDatabaseConnection.mockResolvedValue(undefined);
  mocks.connectRedis.mockResolvedValue(undefined);
  mocks.closeDatabase.mockResolvedValue(undefined);
  mocks.closeRedis.mockResolvedValue(undefined);
  mocks.searchClose.mockResolvedValue(undefined);
  mocks.paymentsClose.mockResolvedValue(undefined);
  mocks.walletClose.mockResolvedValue(undefined);
  mocks.notificationsClose.mockResolvedValue(undefined);
  mocks.reportsClose.mockResolvedValue(undefined);
  mocks.outboxClose.mockResolvedValue(undefined);
  mocks.lifecycleClose.mockResolvedValue(undefined);
  mocks.startSearchDiscoveryRuntime.mockResolvedValue({ close: mocks.searchClose });
  mocks.startPaymentsRuntime.mockResolvedValue({ close: mocks.paymentsClose });
  mocks.startSellerWalletPayoutsRuntime.mockResolvedValue({ close: mocks.walletClose });
  mocks.startNotificationsRuntime.mockResolvedValue({ close: mocks.notificationsClose });
  mocks.startReportsRuntime.mockResolvedValue({ close: mocks.reportsClose });
  mocks.startOutboxRuntime.mockResolvedValue({ close: mocks.outboxClose });
  mocks.startLifecycleMaintenanceRuntime.mockResolvedValue({ close: mocks.lifecycleClose });
}

beforeEach(() => {
  vi.resetAllMocks();
  configureSuccessfulStartupDependencies();
});

describe("Module 18 release startup fail-fast behavior", () => {
  it("never starts HTTP when a required database/Redis dependency cannot become ready", async () => {
    const dependencyError = new Error("database unavailable");
    mocks.checkDatabaseConnection.mockRejectedValue(dependencyError);

    await expect(startServer()).rejects.toBe(dependencyError);

    expect(mocks.startSearchDiscoveryRuntime).not.toHaveBeenCalled();
    expect(mocks.startNotificationsRuntime).not.toHaveBeenCalled();
    expect(mocks.appListen).not.toHaveBeenCalled();
    expect(mocks.closeRedis).toHaveBeenCalledTimes(1);
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it("closes every partially started runtime and never starts HTTP when required outbox startup fails", async () => {
    const outboxError = new Error("outbox worker unavailable");
    mocks.startOutboxRuntime.mockRejectedValue(outboxError);

    await expect(startServer()).rejects.toBe(outboxError);

    expect(mocks.startSearchDiscoveryRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.startPaymentsRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.startSellerWalletPayoutsRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.startNotificationsRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.startReportsRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.startOutboxRuntime).toHaveBeenCalledWith([
      "search-source-events",
      "wallet-source-events",
      "notification-source-events",
      "reports-source-events",
    ]);
    expect(mocks.startLifecycleMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.reportsClose).toHaveBeenCalledTimes(1);
    expect(mocks.notificationsClose).toHaveBeenCalledTimes(1);
    expect(mocks.walletClose).toHaveBeenCalledTimes(1);
    expect(mocks.paymentsClose).toHaveBeenCalledTimes(1);
    expect(mocks.searchClose).toHaveBeenCalledTimes(1);
    expect(mocks.appListen).not.toHaveBeenCalled();
    expect(mocks.closeRedis).toHaveBeenCalledTimes(1);
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
  });
});
