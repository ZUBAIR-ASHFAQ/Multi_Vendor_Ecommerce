import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/common/errors/app-error.js";
import { createWorker } from "../../src/common/jobs/queue.factory.js";
import {
  REPORTS_ERROR_CODE,
  REPORTS_JOB,
  REPORTS_OUTBOX_EVENT,
} from "../../src/modules/reports/reports.constants.js";
import {
  startReportsRuntime,
  type ReportsJobProcessor,
} from "../../src/modules/reports/reports.jobs.js";

vi.mock("../../src/common/jobs/queue.factory.js", () => ({
  createWorker: vi.fn(),
}));

interface FakeJob<TData> {
  id?: string;
  attemptsMade: number;
  opts: { attempts?: number };
  data: TData;
}

type FakeProcessor<TData> = (job: FakeJob<TData>) => Promise<unknown>;

let capturedProcessor: FakeProcessor<unknown>;
const worker = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

/** Creates one Foundation-style domain-event job for the Reports source queue. */
function sourceJob(eventType: string, aggregateId = "report-run-1") {
  return {
    id: `job-${eventType}`,
    attemptsMade: 0,
    opts: { attempts: 5 },
    data: {
      eventId: `event-${eventType}`,
      event: {
        eventType,
        aggregateType: "report_run",
        aggregateId,
        payload: { reportRunId: aggregateId },
      },
    },
  };
}

/** Returns one observable report-runtime processor double. */
function processorDouble(): ReportsJobProcessor {
  return {
    processReportRun: vi.fn().mockResolvedValue(undefined),
    recordReportRunFailure: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  worker.on.mockClear();
  worker.close.mockClear();
  vi.mocked(createWorker).mockImplementation(((name, processor) => {
    expect(name).toBe(REPORTS_JOB.SOURCE_EVENT_QUEUE);
    capturedProcessor = processor as unknown as FakeProcessor<unknown>;
    return worker as never;
  }) as typeof createWorker);
});

describe("Module 20 Reports BullMQ runtime", () => {
  it("processes only report.run_requested and closes its worker exactly once", async () => {
    const processor = processorDouble();
    const runtime = await startReportsRuntime(processor);

    await capturedProcessor(sourceJob(REPORTS_OUTBOX_EVENT.RUN_REQUESTED, "run-1") as never);
    await capturedProcessor(sourceJob(REPORTS_OUTBOX_EVENT.GENERATED, "run-1") as never);
    await capturedProcessor(sourceJob(REPORTS_OUTBOX_EVENT.FAILED, "run-1") as never);

    expect(processor.processReportRun).toHaveBeenCalledTimes(1);
    expect(processor.processReportRun).toHaveBeenCalledWith("run-1");
    expect(processor.recordReportRunFailure).not.toHaveBeenCalled();

    await runtime.close();
    await runtime.close();
    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it("persists only final retry failure and preserves an AppError code", async () => {
    const processor = processorDouble();
    const failure = new AppError({
      code: REPORTS_ERROR_CODE.FILTER_INVALID,
      message: "stored filters invalid",
      statusCode: 422,
    });
    vi.mocked(processor.processReportRun).mockRejectedValue(failure);
    await startReportsRuntime(processor);

    const retrying = sourceJob(REPORTS_OUTBOX_EVENT.RUN_REQUESTED, "run-retrying");
    retrying.attemptsMade = 1;
    await expect(capturedProcessor(retrying as never)).rejects.toBe(failure);
    expect(processor.recordReportRunFailure).toHaveBeenLastCalledWith(
      "run-retrying",
      REPORTS_ERROR_CODE.FILTER_INVALID,
      false,
    );

    const finalAttempt = sourceJob(REPORTS_OUTBOX_EVENT.RUN_REQUESTED, "run-final");
    finalAttempt.attemptsMade = 4;
    await expect(capturedProcessor(finalAttempt as never)).rejects.toBe(failure);
    expect(processor.recordReportRunFailure).toHaveBeenLastCalledWith(
      "run-final",
      REPORTS_ERROR_CODE.FILTER_INVALID,
      true,
    );
  });

  it("normalizes unexpected worker errors to REPORT_EXPORT_FAILED", async () => {
    const processor = processorDouble();
    vi.mocked(processor.processReportRun).mockRejectedValue(new Error("storage offline"));
    await startReportsRuntime(processor);

    const finalAttempt = sourceJob(REPORTS_OUTBOX_EVENT.RUN_REQUESTED, "run-storage");
    finalAttempt.attemptsMade = 4;
    await expect(capturedProcessor(finalAttempt as never)).rejects.toThrow("storage offline");
    expect(processor.recordReportRunFailure).toHaveBeenCalledWith(
      "run-storage",
      REPORTS_ERROR_CODE.EXPORT_FAILED,
      true,
    );
  });
});
