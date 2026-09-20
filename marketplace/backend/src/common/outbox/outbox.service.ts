import type { DatabaseExecutor } from "../../database/types.js";
import { OutboxRepository, type EnqueueOutboxEventInput } from "./outbox.repository.js";

/** Transaction-aware domain-event writer used by later business services. */
export class OutboxService {
  /** Stores the repository used to append durable domain events. */
  constructor(private readonly repository: OutboxRepository) {}

  /** Creates a transaction-aware outbox service for one database executor. */
  static using(executor: DatabaseExecutor): OutboxService {
    return new OutboxService(new OutboxRepository(executor));
  }

  /** Appends one durable domain event and returns its generated identifier. */
  async enqueue<TPayload>(event: EnqueueOutboxEventInput<TPayload>): Promise<string> {
    const row = await this.repository.enqueue(event);
    return row.id;
  }
}
