import { createQueue, createWorker } from "../../common/jobs/queue.factory.js";
import { PAYMENTS_JOB } from "./payments.constants.js";

/** Data carried by one capture-to-Order reconciliation retry. */
export interface PaymentCaptureReconciliationJobData {
  paymentTransactionId: string;
}

/** Data carried by one provider refund reconciliation retry. */
export interface PaymentRefundReconciliationJobData {
  paymentTransactionId: string;
}

/** Data carried by one unpaid-Payment expiry job. */
export interface PaymentExpiryJobData {
  paymentId: string;
}

/** Data carried by one bounded overdue Order maintenance scan. */
export interface PaymentOverdueOrderScanJobData {
  limit: number;
}

/** Union of the simple Payments job payloads processed by one worker. */
export type PaymentsJobData =
  | PaymentCaptureReconciliationJobData
  | PaymentRefundReconciliationJobData
  | PaymentExpiryJobData
  | PaymentOverdueOrderScanJobData;

/** Minimum service behavior required by the Payments worker. */
export interface PaymentsJobProcessor {
  /** Rechecks provider capture and retries the exact Module 11 confirmation source. */
  reconcileCapture(paymentTransactionId: string): Promise<void>;

  /** Rechecks one pending provider refund and applies its authoritative result. */
  reconcileRefund(paymentTransactionId: string): Promise<void>;

  /** Cancels one overdue unpaid provider intent and expires its unpaid Order. */
  expireUnpaidPayment(paymentId: string): Promise<void>;

  /** Scans overdue unpaid Orders so Orders without a Payment row are not left stale. */
  expireOverdueOrders(limit: number): Promise<number>;
}

/** Background resources owned by the Payments reconciliation and maintenance queue. */
export interface PaymentsRuntime {
  /** Stops the Payments worker and closes the scheduler queue connection. */
  close(): Promise<void>;
}

const PAYMENT_OVERDUE_SCAN_INTERVAL_MS = 60_000;
const PAYMENT_OVERDUE_SCAN_LIMIT = 100;

/** Enqueues one retry-safe capture reconciliation job keyed by the local capture transaction. */
export async function enqueuePaymentCaptureReconciliationJob(
  paymentTransactionId: string,
): Promise<void> {
  const queue = createQueue<PaymentCaptureReconciliationJobData>(PAYMENTS_JOB.QUEUE);
  try {
    await queue.add(
      PAYMENTS_JOB.CAPTURE_RECONCILIATION,
      { paymentTransactionId },
      { jobId: `capture-${paymentTransactionId}` },
    );
  } finally {
    await queue.close();
  }
}

/** Enqueues one retry-safe refund reconciliation job keyed by the local refund transaction. */
export async function enqueuePaymentRefundReconciliationJob(
  paymentTransactionId: string,
): Promise<void> {
  const queue = createQueue<PaymentRefundReconciliationJobData>(PAYMENTS_JOB.QUEUE);
  try {
    await queue.add(
      PAYMENTS_JOB.REFUND_RECONCILIATION,
      { paymentTransactionId },
      { jobId: `refund-${paymentTransactionId}` },
    );
  } finally {
    await queue.close();
  }
}

/** Enqueues one delayed unpaid-Payment expiry job at the immutable Checkout deadline. */
export async function enqueuePaymentExpiryJob(paymentId: string, runAt: Date): Promise<void> {
  const queue = createQueue<PaymentExpiryJobData>(PAYMENTS_JOB.QUEUE);
  const delay = Math.max(0, runAt.getTime() - Date.now());
  try {
    await queue.add(
      PAYMENTS_JOB.EXPIRE_UNPAID,
      { paymentId },
      { jobId: `expiry-${paymentId}`, delay },
    );
  } finally {
    await queue.close();
  }
}

/** Creates the Payments reconciliation, expiry, and overdue-Order maintenance worker. */
export function createPaymentsWorker(processor: PaymentsJobProcessor) {
  return createWorker<PaymentsJobData>(PAYMENTS_JOB.QUEUE, async (job) => {
    if (job.name === PAYMENTS_JOB.CAPTURE_RECONCILIATION) {
      const data = job.data as PaymentCaptureReconciliationJobData;
      await processor.reconcileCapture(data.paymentTransactionId);
      return;
    }

    if (job.name === PAYMENTS_JOB.REFUND_RECONCILIATION) {
      const data = job.data as PaymentRefundReconciliationJobData;
      await processor.reconcileRefund(data.paymentTransactionId);
      return;
    }

    if (job.name === PAYMENTS_JOB.EXPIRE_UNPAID) {
      const data = job.data as PaymentExpiryJobData;
      await processor.expireUnpaidPayment(data.paymentId);
      return;
    }

    if (job.name === PAYMENTS_JOB.OVERDUE_ORDER_SCAN) {
      const data = job.data as PaymentOverdueOrderScanJobData;
      await processor.expireOverdueOrders(data.limit);
      return;
    }

    throw new Error(`Unsupported Payments job name: ${job.name}`);
  });
}

/** Starts the Payments worker plus the recurring bounded scan for Orders that never created a Payment row. */
export async function startPaymentsRuntime(
  processor: PaymentsJobProcessor,
): Promise<PaymentsRuntime> {
  const queue = createQueue<PaymentsJobData>(PAYMENTS_JOB.QUEUE);
  const worker = createPaymentsWorker(processor);
  let closed = false;

  try {
    await queue.upsertJobScheduler(
      PAYMENTS_JOB.OVERDUE_ORDER_SCAN,
      { every: PAYMENT_OVERDUE_SCAN_INTERVAL_MS },
      {
        name: PAYMENTS_JOB.OVERDUE_ORDER_SCAN,
        data: { limit: PAYMENT_OVERDUE_SCAN_LIMIT },
      },
    );
  } catch (error) {
    await Promise.allSettled([worker.close(), queue.close()]);
    throw error;
  }

  return {
    /** Stops new Payments background work while leaving the persisted scheduler definition reusable after restart. */
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.allSettled([worker.close(), queue.close()]);
    },
  };
}
