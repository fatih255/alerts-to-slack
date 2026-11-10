import type { NormalizedAlert } from "../model.js";

/** What we remember about one open (still firing) problem. */
export interface AlertGroup {
  fingerprint: string;
  /** The latest alert we saw for this fingerprint. */
  alert: NormalizedAlert;
  firstSeenAt: number;
  lastSeenAt: number;
  /** When the current grouping window started, i.e. when we last posted. */
  windowStartedAt: number;
  /** Every firing alert since the group opened, including the first. */
  totalCount: number;
  /** Alerts we've counted but not posted about yet. */
  pendingCount: number;
}

/**
 * Where groups live between requests. Swap the in-memory store for a shared one
 * (DynamoDB, Redis) if more than one process handles alerts.
 */
export interface AlertStore {
  get(fingerprint: string): Promise<AlertGroup | undefined>;
  put(group: AlertGroup): Promise<void>;
  delete(fingerprint: string): Promise<void>;
  /** Groups that have counted alerts waiting to be posted. */
  listPending(): Promise<AlertGroup[]>;
}

export class MemoryStore implements AlertStore {
  private readonly groups = new Map<string, AlertGroup>();

  async get(fingerprint: string) {
    const group = this.groups.get(fingerprint);
    return group && structuredClone(group);
  }

  async put(group: AlertGroup) {
    this.groups.set(group.fingerprint, structuredClone(group));
  }

  async delete(fingerprint: string) {
    this.groups.delete(fingerprint);
  }

  async listPending() {
    return [...this.groups.values()].filter((g) => g.pendingCount > 0).map((g) => structuredClone(g));
  }
}
