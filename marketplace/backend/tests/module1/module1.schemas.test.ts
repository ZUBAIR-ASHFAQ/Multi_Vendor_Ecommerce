import { describe, expect, it } from "vitest";
import {
  dashboardAlertsQuerySchema,
  dashboardLayoutSchema,
  dashboardSummaryQuerySchema,
  updateDashboardPreferencesBodySchema,
} from "../../src/modules/dashboard/dashboard.schema.js";
import {
  DASHBOARD_ERROR_CODE,
  DASHBOARD_PATH,
  DASHBOARD_PERMISSION,
} from "../../src/modules/dashboard/dashboard.constants.js";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";

/** Builds one valid ISO date string for concise date-range tests. */
function isoDate(day: number): string {
  return new Date(Date.UTC(2026, 0, day)).toISOString();
}

describe("Module 1 Dashboard contracts", () => {
  it("keeps the exact documented Dashboard route surface", () => {
    expect(Object.values(DASHBOARD_PATH)).toEqual([
      "/api/v1/dashboard/summary",
      "/api/v1/dashboard/orders",
      "/api/v1/dashboard/sellers",
      "/api/v1/dashboard/alerts",
      "/api/v1/dashboard/preferences",
    ]);
  });

  it("keeps the representative Dashboard permission codes", () => {
    expect(Object.values(DASHBOARD_PERMISSION)).toEqual([
      "dashboard.read",
      "dashboard.finance.read",
      "dashboard.seller.read",
      "dashboard.manage_preferences",
    ]);
  });

  it("keeps the exact stable Dashboard business error codes", () => {
    expect(Object.values(DASHBOARD_ERROR_CODE)).toEqual([
      "DASHBOARD_SCOPE_FORBIDDEN",
      "DASHBOARD_WIDGET_UNAVAILABLE",
      "INVALID_DASHBOARD_FILTER",
    ]);
  });

  it("accepts documented Dashboard date, seller, store, and category filters", () => {
    const result = dashboardSummaryQuerySchema.parse({
      from: isoDate(1),
      to: isoDate(30),
      sellerId: UUID_A,
      storeId: UUID_B,
      categoryId: UUID_A,
    });

    expect(result.sellerId).toBe(UUID_A);
    expect(result.storeId).toBe(UUID_B);
    expect(result.categoryId).toBe(UUID_A);
  });

  it("rejects a reversed Dashboard date range", () => {
    expect(() =>
      dashboardSummaryQuerySchema.parse({ from: isoDate(30), to: isoDate(1) }),
    ).toThrow();
  });

  it("rejects an unbounded Dashboard date range over the safety limit", () => {
    expect(() =>
      dashboardSummaryQuerySchema.parse({
        from: "2025-01-01T00:00:00.000Z",
        to: "2026-02-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects unknown Dashboard widget codes", () => {
    expect(() =>
      dashboardLayoutSchema.parse({
        widgets: [{ widgetCode: "unknown_widget", order: 0, visible: true }],
      }),
    ).toThrow();
  });

  it("requires at least one field in the Dashboard preferences patch", () => {
    expect(() => updateDashboardPreferencesBodySchema.parse({})).toThrow();
  });

  it("accepts preference updates and saved filters through the one documented preferences command", () => {
    const result = updateDashboardPreferencesBodySchema.parse({
      defaultDateRange: "last_30_days",
      defaultStoreId: UUID_B,
      layout: {
        widgets: [{ widgetCode: "executive_kpis", order: 0, visible: true }],
      },
      savedFilters: [
        {
          name: "My store",
          filters: { sellerId: UUID_A, storeId: UUID_B },
        },
      ],
    });

    expect(result.savedFilters).toHaveLength(1);
  });

  it("keeps alert pagination bounded through the shared pagination schema", () => {
    expect(() => dashboardAlertsQuerySchema.parse({ page: 1, pageSize: 1000 })).toThrow();
  });
});
