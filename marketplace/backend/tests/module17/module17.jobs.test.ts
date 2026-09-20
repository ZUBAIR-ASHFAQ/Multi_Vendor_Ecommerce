import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueue, createWorker } from "../../src/common/jobs/queue.factory.js";
import { COMMISSIONS_OUTBOX_EVENT } from "../../src/modules/commissions/commissions.constants.js";
import {
  WALLET_PAYOUT_JOB,
  WALLET_PAYOUT_LIMITS,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.constants.js";
import {
  startSellerWalletPayoutsRuntime,
  type WalletPayoutJobProcessor,
} from "../../src/modules/seller-wallet-payouts/seller-wallet-payouts.jobs.js";

vi.mock("../../src/common/jobs/queue.factory.js", () => ({
  createQueue: vi.fn(),
  createWorker: vi.fn(),
}));

interface FakeJob<TData> {
  id?: string;
  timestamp: number;
  data: TData;
}

type FakeProcessor<TData> = (job: FakeJob<TData>) => Promise<unknown>;

interface WorkerDouble {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface QueueDouble {
  upsertJobScheduler: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const workerProcessors = new Map<string, FakeProcessor<unknown>>();
const workers = new Map<string, WorkerDouble>();
let settlementQueue: QueueDouble;

/** Creates one worker double and captures its processor so tests can execute BullMQ work without Redis. */
function makeWorker(name: string, processor: FakeProcessor<unknown>): WorkerDouble {
  const worker: WorkerDouble = {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  workerProcessors.set(name, processor);
  workers.set(name, worker);
  return worker;
}

/** Returns one previously captured worker processor with a readable failure when wiring is missing. */
function processorFor<TData>(name: string): FakeProcessor<TData> {
  const processor = workerProcessors.get(name);
  if (!processor) throw new Error(`Expected worker processor for ${name}.`);
  return processor as FakeProcessor<TData>;
}

beforeEach(() => {
  workerProcessors.clear();
  workers.clear();
  settlementQueue = {
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  vi.mocked(createQueue).mockReturnValue(settlementQueue as never);
  vi.mocked(createWorker).mockImplementation(((name, processor) => {
    return makeWorker(
      String(name),
      processor as unknown as FakeProcessor<unknown>,
    ) as never;
  }) as typeof createWorker);
});

describe("Module 17 Wallet/Payout background runtime", () => {
  it("schedules one bounded recurring settlement scan and keeps worker shutdown idempotent", async () => {
    const processor: WalletPayoutJobProcessor = {
      handleSourceEvent: vi.fn().mockResolvedValue(undefined),
      settleScheduledWallets: vi.fn().mockResolvedValue({
        scanned: 0,
        settled: 0,
        skipped: 0,
      }),
    };

    const runtime = await startSellerWalletPayoutsRuntime(processor);

    expect(settlementQueue.upsertJobScheduler).toHaveBeenCalledWith(
      WALLET_PAYOUT_JOB.SETTLE_ELIGIBLE,
      { every: 60_000 },
      {
        name: WALLET_PAYOUT_JOB.SETTLE_ELIGIBLE,
        data: {
          input: { limit: WALLET_PAYOUT_LIMITS.SETTLEMENT_LIMIT_DEFAULT },
          idempotencyKey: "scheduler-replaced-by-occurrence-id",
        },
      },
    );
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(createQueue).toHaveBeenCalledWith(WALLET_PAYOUT_JOB.SETTLEMENT_QUEUE);

    await runtime.close();
    await runtime.close();

    expect(workers.get(WALLET_PAYOUT_JOB.SOURCE_EVENT_QUEUE)?.close).toHaveBeenCalledTimes(1);
    expect(workers.get(WALLET_PAYOUT_JOB.SETTLEMENT_QUEUE)?.close).toHaveBeenCalledTimes(1);
    expect(settlementQueue.close).toHaveBeenCalledTimes(1);
  });

  it("forwards Commission events and derives a stable settlement retry key from the BullMQ occurrence", async () => {
    const processor: WalletPayoutJobProcessor = {
      handleSourceEvent: vi.fn().mockResolvedValue(undefined),
      settleScheduledWallets: vi.fn().mockResolvedValue({
        scanned: 1,
        settled: 1,
        skipped: 0,
      }),
    };
    const runtime = await startSellerWalletPayoutsRuntime(processor);
    const commissionEntryId = "11111111-1111-4111-8111-111111111111";
    const sourceJob = {
      id: "commission-job-1",
      timestamp: 1_789_470_000_000,
      data: {
        eventId: "event-1",
        event: {
          eventType: COMMISSIONS_OUTBOX_EVENT.POSTED,
          aggregateType: "commission_entry",
          aggregateId: commissionEntryId,
          payload: { commissionEntryId },
        },
      },
    };
    const settlementJob = {
      id: "repeat:wallet-settlement:1789470000000",
      timestamp: 1_789_470_000_000,
      data: {
        input: { limit: 25 },
        idempotencyKey: "scheduler-placeholder",
      },
    };

    await processorFor<typeof sourceJob.data>(
      WALLET_PAYOUT_JOB.SOURCE_EVENT_QUEUE,
    )(sourceJob);
    const settleProcessor = processorFor<typeof settlementJob.data>(
      WALLET_PAYOUT_JOB.SETTLEMENT_QUEUE,
    );
    await settleProcessor(settlementJob);
    await settleProcessor(settlementJob);

    expect(processor.handleSourceEvent).toHaveBeenCalledTimes(1);
    expect(processor.handleSourceEvent).toHaveBeenCalledWith(sourceJob.data);
    expect(processor.settleScheduledWallets).toHaveBeenCalledTimes(2);
    expect(processor.settleScheduledWallets).toHaveBeenNthCalledWith(1, {
      input: { limit: 25 },
      idempotencyKey: `module17:settlement:${settlementJob.id}`,
    });
    expect(processor.settleScheduledWallets).toHaveBeenNthCalledWith(2, {
      input: { limit: 25 },
      idempotencyKey: `module17:settlement:${settlementJob.id}`,
    });

    await runtime.close();
  });
});
