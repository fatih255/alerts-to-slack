import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Grouper, type Notification } from "../src/grouping/grouper.js";
import { MemoryStore } from "../src/grouping/store.js";
import { makeAlert } from "./helpers.js";

const WINDOW = 5 * 60_000;

describe("Grouper", () => {
  let store: MemoryStore;
  let grouper: Grouper;
  let sent: Notification[];
  const send = async (n: Notification) => {
    sent.push(n);
  };
  const tick = (ms: number) => vi.advanceTimersByTime(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T09:00:00Z"));
    store = new MemoryStore();
    grouper = new Grouper(store, WINDOW);
    sent = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("posts the first alert right away", async () => {
    const outcome = await grouper.handle(makeAlert(), Date.now(), send);
    expect(outcome).toEqual({ posted: { kind: "new", alert: makeAlert() } });
    expect(sent).toHaveLength(1);
  });

  it("counts repeats inside the window without posting", async () => {
    await grouper.handle(makeAlert(), Date.now(), send);
    for (let i = 1; i <= 3; i++) {
      tick(60_000);
      const outcome = await grouper.handle(makeAlert(), Date.now(), send);
      expect(outcome).toEqual({ suppressed: { fingerprint: "sentry:1", pendingCount: i } });
    }
    expect(sent).toHaveLength(1);
  });

  it("posts one message with the count for the first repeat after the window", async () => {
    const start = Date.now();
    await grouper.handle(makeAlert(), start, send);
    tick(60_000);
    await grouper.handle(makeAlert(), Date.now(), send);
    tick(60_000);
    await grouper.handle(makeAlert(), Date.now(), send);
    tick(WINDOW); // well past the window
    await grouper.handle(makeAlert({ summary: "latest" }), Date.now(), send);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      kind: "repeat",
      alert: makeAlert({ summary: "latest" }),
      count: 3,
      totalCount: 4,
      windowStartedAt: start,
      firstSeenAt: start,
    });

    // A new window started with that message.
    tick(1000);
    expect(await grouper.handle(makeAlert(), Date.now(), send)).toMatchObject({ suppressed: { pendingCount: 1 } });
  });

  it("treats the exact window boundary as outside the window", async () => {
    await grouper.handle(makeAlert(), Date.now(), send);
    tick(WINDOW - 1);
    expect(await grouper.handle(makeAlert(), Date.now(), send)).toHaveProperty("suppressed");
    tick(1);
    expect(await grouper.handle(makeAlert(), Date.now(), send)).toHaveProperty("posted");
  });

  it("keeps different fingerprints apart", async () => {
    await grouper.handle(makeAlert(), Date.now(), send);
    await grouper.handle(makeAlert({ fingerprint: "sentry:2" }), Date.now(), send);
    expect(sent.map((n) => n.kind)).toEqual(["new", "new"]);
  });

  it("flush posts waiting counts once the window has closed", async () => {
    await grouper.handle(makeAlert(), Date.now(), send);
    await grouper.handle(makeAlert({ fingerprint: "sentry:2" }), Date.now(), send);
    tick(1000);
    await grouper.handle(makeAlert(), Date.now(), send);
    await grouper.handle(makeAlert(), Date.now(), send);

    expect(await grouper.flush(Date.now(), send)).toEqual([]);

    tick(WINDOW);
    const flushed = await grouper.flush(Date.now(), send);
    expect(flushed).toHaveLength(1); // sentry:2 had nothing pending
    expect(flushed[0]).toMatchObject({ kind: "repeat", count: 2, totalCount: 3 });

    // Nothing left to flush until more alerts arrive.
    tick(WINDOW);
    expect(await grouper.flush(Date.now(), send)).toEqual([]);
  });

  it("posts a resolved follow-up with the group's history and closes the group", async () => {
    const start = Date.now();
    await grouper.handle(makeAlert(), start, send);
    tick(30_000);
    await grouper.handle(makeAlert(), Date.now(), send);
    tick(12 * 60_000);

    const outcome = await grouper.handle(makeAlert({ status: "resolved" }), Date.now(), send);
    expect(outcome).toEqual({
      posted: {
        kind: "resolved",
        alert: makeAlert({ status: "resolved" }),
        history: { totalCount: 2, firstSeenAt: start },
      },
    });
    expect(await store.get("sentry:1")).toBeUndefined();

    // The next firing alert opens a fresh group.
    tick(1000);
    expect(await grouper.handle(makeAlert(), Date.now(), send)).toMatchObject({ posted: { kind: "new" } });
  });

  it("still posts a resolved message when it never saw the alert fire", async () => {
    await grouper.handle(makeAlert({ status: "resolved" }), Date.now(), send);
    expect(sent).toEqual([{ kind: "resolved", alert: makeAlert({ status: "resolved" }), history: undefined }]);
  });

  it("doesn't record anything when Slack rejects the message", async () => {
    const failing = async () => {
      throw new Error("slack down");
    };
    await expect(grouper.handle(makeAlert(), Date.now(), failing)).rejects.toThrow("slack down");
    expect(await store.get("sentry:1")).toBeUndefined();

    // The retry is treated as a first alert again.
    expect(await grouper.handle(makeAlert(), Date.now(), send)).toMatchObject({ posted: { kind: "new" } });

    tick(WINDOW);
    await expect(grouper.handle(makeAlert(), Date.now(), failing)).rejects.toThrow();
    expect(await store.get("sentry:1")).toMatchObject({ totalCount: 1, pendingCount: 0 });
  });
});
