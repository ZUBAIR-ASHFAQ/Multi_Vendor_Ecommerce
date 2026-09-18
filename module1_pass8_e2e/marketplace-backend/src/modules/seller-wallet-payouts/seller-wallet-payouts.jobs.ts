import { logger } from "../../common/logger/logger.js";
import { createQueue, createWorker } from "../../common/jobs/queue.factory.js";
import type { DomainEventJobData } from "../../common/outbox/bullmq-event.publisher.js";
import { COMMISSIONS_OUTBOX_EVENT } from "../commissions/commissions.constants.js";
import {
  WALLET_PAYOUT_JOB,
  WALLET_PAYOUT_LIMITS,
} from "./seller-wallet-payouts.constants.js";
import type {
  SettleWalletInput,
  SettleWalletResult,
} from "./seller-wallet-payouts.schema.js";

/** Commission domain events that Module 17 is allowed to consume from its independent source queue. */
export const WALLET_PAYOUT_SOURCE_EVENT_VALUES = [
  COMMISSIONS_OUTBOX_EVENT.POSTED,
  COMMISSIONS_OUTBOX_EVENT.ADJUSTED,
] as const;

/** Stable Foundation outbox payload consumed by the Module 17 source-event worker. */
export type WalletPayoutSourceEventJobData = DomainEventJobData;

/** Trusted bounded payload for one automatic Wallet settlement scan. */
export interface WalletSettlementJobData {
  input: SettleWalletInput;
  idempotencyKey: string;
}

/** Minimum business boundary required by the Module 17 background runtime. */
export interface WalletPayoutJobProcessor {
  /** Applies or ignores one committed domain event without bypassing Module 16 source truth. */
  handleSourceEvent(job: WalletPayoutSourceEventJobData): Promise<void>;

  /** Runs one retry-safe bounded pending-to-available settlement batch. */
  settleScheduledWallets(job: WalletSettlementJobData): Promise<SettleWalletResult>;
}

/** Background resources owned only by Module 17 Wallet/Payout processing. */
export interface SellerWalletPayoutsRuntime {
  /** Stops Wallet source-event and settlement workers plus the settlement scheduler connection. */
  close(): Promise<void>;
}

const WALLET_SETTLEMENT_INTERVAL_MS = 60_000;

/** Builds one stable retry key from the BullMQ occurrence so retries replay but later scans can process new work. */
function settlementIdempotencyKey(jobId: string | undefined, timestamp: number): string {
  return `module17:settlement:${jobId ?? timestamp}`;
}

/** Starts the independent Commission-event consumer and recurring bounded Wallet settlement worker. */
export async function startSellerWalletPayoutsRuntime(
  processor: WalletPayoutJobProcessor,
): Promise<SellerWalletPayoutsRuntime> {
  const sourceEventWorker = createWorker<WalletPayoutSourceEventJobData>(
    WALLET_PAYOUT_JOB.SOURCE_EVENT_QUEUE,
    async (job) => {
      await processor.handleSourceEvent(job.data);
    },
  );
  const settlementQueue = createQueue<WalletSettlementJobData>(
    WALLET_PAYOUT_JOB.SETTLEMENT_QUEUE,
  );
  const settlementWorker = createWorker<WalletSettlementJobData>(
    WALLET_PAYOUT_JOB.SETTLEMENT_QUEUE,
    async (job) => {
      await processor.settleScheduledWallets({
        input: job.data.input,
        idempotencyKey: settlementIdempotencyKey(job.id, job.timestamp),
      });
    },
    { concurrency: 1 },
  );
  let closed = false;

  /** Logs a failed Commission source event after BullMQ applies its retry policy. */
  function logSourceEventFailure(
    job: { id?: string; data: WalletPayoutSourceEventJobData } | undefined,
    error: Error,
  ): void {
    logger.error(
      { err: error, jobId: job?.id, eventType: job?.data.event.eventType },
      "Wallet source-event job failed",
    );
  }

  /** Logs a failed automatic settlement scan without hiding the next scheduled retry opportunity. */
  function logSettlementFailure(
    job: { id?: string } | undefined,
    error: Error,
  ): void {
    logger.error(
      { err: error, jobId: job?.id },
      "Wallet settlement job failed",
    );
  }

  sourceEventWorker.on("failed", logSourceEventFailure);
  settlementWorker.on("failed", logSettlementFailure);

  try {
    await settlementQueue.upsertJobScheduler(
      WALLET_PAYOUT_JOB.SETTLE_ELIGIBLE,
      { every: WALLET_SETTLEMENT_INTERVAL_MS },
      {
        name: WALLET_PAYOUT_JOB.SETTLE_ELIGIBLE,
        data: {
          input: { limit: WALLET_PAYOUT_LIMITS.SETTLEMENT_LIMIT_DEFAULT },
          idempotencyKey: "scheduler-replaced-by-occurrence-id",
        },
      },
    );
  } catch (error) {
    await Promise.allSettled([
      sourceEventWorker.close(),
      settlementWorker.close(),
      settlementQueue.close(),
    ]);
    throw error;
  }

  return {
    /** Stops new Module 17 background work while leaving the persisted scheduler reusable after restart. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.allSettled([
        sourceEventWorker.close(),
        settlementWorker.close(),
        settlementQueue.close(),
      ]);
    },
  };
}
