import { describe, expect, it } from "vitest";
import { parseCloudWatchAlarm } from "../src/parsers/cloudwatch.js";
import { parseSentryWebhook } from "../src/parsers/sentry.js";
import { buildMessage, escape, formatDuration } from "../src/slack/blocks.js";
import { alarmMessage, fixture, makeAlert } from "./helpers.js";

const NOW = Date.parse("2026-11-10T09:32:05Z");
const sentryAlert = parseSentryWebhook("event_alert", fixture("sentry-issue-alert.json"))!;
const cwAlarm = parseCloudWatchAlarm(alarmMessage("sns-cloudwatch-alarm.json"))!;
const cwOk = parseCloudWatchAlarm(alarmMessage("sns-cloudwatch-ok.json"))!;

describe("Block Kit messages", () => {
  it("new Sentry alert", () => {
    expect(buildMessage({ kind: "new", alert: sentryAlert }, NOW)).toMatchSnapshot();
  });

  it("new CloudWatch alarm", () => {
    expect(buildMessage({ kind: "new", alert: cwAlarm }, NOW)).toMatchSnapshot();
  });

  it("grouped repeat", () => {
    const message = buildMessage(
      {
        kind: "repeat",
        alert: sentryAlert,
        count: 4,
        totalCount: 5,
        windowStartedAt: NOW - 5 * 60_000,
        firstSeenAt: NOW - 5 * 60_000,
      },
      NOW,
    );
    expect(message).toMatchSnapshot();
    expect(message.text).toBe(
      "[Error] Still firing (4 more): TypeError: Cannot read properties of undefined (reading 'discount') (web-app)",
    );
  });

  it("resolved with history", () => {
    const message = buildMessage(
      { kind: "resolved", alert: cwOk, history: { totalCount: 3, firstSeenAt: NOW - 18 * 60_000 } },
      NOW,
    );
    expect(message).toMatchSnapshot();
  });

  it("resolved without history", () => {
    const message = buildMessage({ kind: "resolved", alert: cwOk }, NOW);
    const fields = message.blocks.find((b) => b.type === "section" && b.fields);
    expect(JSON.stringify(fields)).toContain("No firing alert on record");
  });

  it("only adds the triage checklist to new alerts", () => {
    const triage = (kind: "new" | "resolved") =>
      JSON.stringify(buildMessage({ kind, alert: sentryAlert } as never, NOW)).includes("reproduce it first");
    expect(triage("new")).toBe(true);
    expect(triage("resolved")).toBe(false);
  });

  it("escapes Slack control characters in alert text", () => {
    const message = buildMessage(
      { kind: "new", alert: makeAlert({ service: "<!channel>", summary: "a < b && c > d" }) },
      NOW,
    );
    const json = JSON.stringify(message);
    expect(json).not.toContain("<!channel>");
    expect(json).toContain("&lt;!channel&gt;");
    expect(json).toContain("> a &lt; b &amp;&amp; c &gt; d");
  });

  it("keeps headers inside Slack's 150 character limit", () => {
    const message = buildMessage({ kind: "new", alert: makeAlert({ title: "x".repeat(400) }) }, NOW);
    const header = message.blocks[0];
    expect(header?.type).toBe("header");
    if (header?.type === "header") expect(header.text.text.length).toBeLessThanOrEqual(150);
  });

  it("leaves out the summary block when there's no summary", () => {
    const message = buildMessage({ kind: "new", alert: makeAlert({ summary: "" }) }, NOW);
    expect(message.blocks.map((b) => b.type)).toEqual(["header", "section", "actions", "context"]);
  });
});

describe("helpers", () => {
  it("formats durations for people", () => {
    expect(formatDuration(4_400)).toBe("4s");
    expect(formatDuration(5 * 60_000)).toBe("5 min");
    expect(formatDuration(60 * 60_000)).toBe("1 h");
    expect(formatDuration(83 * 60_000)).toBe("1 h 23 min");
  });

  it("escapes &, < and >", () => {
    expect(escape("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
});
