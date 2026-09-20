import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { env } from "../../config/env.js";

/** BullMQ requires maxRetriesPerRequest=null for blocking worker connections. */
export function createBullConnection(connectionName: string): Redis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectionName: `${env.SERVICE_NAME}:${connectionName}`,
  });
}

/** Creates a queue with stable retry/backoff defaults; business queues are added later. */
export function createQueue<DataType = unknown, ResultType = unknown, NameType extends string = string>(
  name: string,
  options: Omit<QueueOptions, "connection" | "prefix"> = {},
): Queue<DataType, ResultType, NameType> {
  return new Queue<DataType, ResultType, NameType>(name, {
    connection: createBullConnection(`queue:${name}`),
    prefix: env.BULLMQ_PREFIX,
    defaultJobOptions: {
      attempts: env.JOB_DEFAULT_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: env.JOB_BACKOFF_MS,
      },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
    ...options,
  });
}

/** Creates a worker without starting domain-specific workers during Foundation. */
export function createWorker<DataType = unknown, ResultType = unknown, NameType extends string = string>(
  name: string,
  processor: Processor<DataType, ResultType, NameType>,
  options: Omit<WorkerOptions, "connection" | "prefix"> = {},
): Worker<DataType, ResultType, NameType> {
  return new Worker<DataType, ResultType, NameType>(name, processor, {
    connection: createBullConnection(`worker:${name}`),
    prefix: env.BULLMQ_PREFIX,
    concurrency: env.JOB_DEFAULT_CONCURRENCY,
    ...options,
  });
}
