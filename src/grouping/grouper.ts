import type { NormalizedAlert } from "../model.js";
import type { AlertGroup, AlertStore } from "./store.js";

/** What should go to Slack. The message builder turns this into Block Kit. */
export type Notification =
  | { kind: "new"; alert: NormalizedAlert }
  | {
      kind: "repeat";
      alert: NormalizedAlert;
      /** Alerts since the last message. */
      count: number;
      /** Alerts since the group opened. */
      totalCount: number;
      windowStartedAt: number;
      firstSeenAt: number;
    }
  | {
      kind: "resolved";
      alert: NormalizedAlert;
      /** Missing when we never saw it fire (e.g. the store was reset). */
      history?: { totalCount: number; firstSeenAt: number };
    };

export type Send = (notification: Notification, now: number) => Promise<void>;

export type Outcome = { posted: Notification } | { suppressed: { fingerprint: string; pendingCount: number } };

/**
 * Groups alerts by fingerprint:
 * - the first firing alert posts right away;
 * - repeats inside the window are only counted;
 * - the first repeat after the window, or a flush(), posts one message with the count;
 * - a resolved alert posts a follow-up and closes the group.
 *
 * State is saved only after Slack accepted the message, so a failed post is retried
 * on the next delivery instead of being silently counted.
 */
export class Grouper {
  constructor(
    private readonly store: AlertStore,
    private readonly windowMs: number,
  ) {}

  async handle(alert: NormalizedAlert, now: number, send: Send): Promise<Outcome> {
    const group = await this.store.get(alert.fingerprint);

    if (alert.status === "resolved") {
      const notification: Notification = {
        kind: "resolved",
        alert,
        history: group && { totalCount: group.totalCount, firstSeenAt: group.firstSeenAt },
      };
      await send(notification, now);
      await this.store.delete(alert.fingerprint);
      return { posted: notification };
    }

    if (!group) {
      const notification: Notification = { kind: "new", alert };
      await send(notification, now);
      await this.store.put({
        fingerprint: alert.fingerprint,
        alert,
        firstSeenAt: now,
        lastSeenAt: now,
        windowStartedAt: now,
        totalCount: 1,
        pendingCount: 0,
      });
      return { posted: notification };
    }

    const next: AlertGroup = {
      ...group,
      alert,
      lastSeenAt: now,
      totalCount: group.totalCount + 1,
      pendingCount: group.pendingCount + 1,
    };

    if (now - group.windowStartedAt < this.windowMs) {
      await this.store.put(next);
      return { suppressed: { fingerprint: alert.fingerprint, pendingCount: next.pendingCount } };
    }

    const notification = repeatOf(next);
    await send(notification, now);
    await this.store.put({ ...next, pendingCount: 0, windowStartedAt: now });
    return { posted: notification };
  }

  /** Posts counts for groups whose window has ended. Call it on a timer or schedule. */
  async flush(now: number, send: Send): Promise<Notification[]> {
    const posted: Notification[] = [];
    for (const group of await this.store.listPending()) {
      if (now - group.windowStartedAt < this.windowMs) continue;
      const notification = repeatOf(group);
      await send(notification, now);
      await this.store.put({ ...group, pendingCount: 0, windowStartedAt: now });
      posted.push(notification);
    }
    return posted;
  }
}

function repeatOf(group: AlertGroup): Notification {
  return {
    kind: "repeat",
    alert: group.alert,
    count: group.pendingCount,
    totalCount: group.totalCount,
    windowStartedAt: group.windowStartedAt,
    firstSeenAt: group.firstSeenAt,
  };
}
