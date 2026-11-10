import { describe, expect, it } from "vitest";
import { PayloadError } from "../src/model.js";
import { parseCloudWatchAlarm } from "../src/parsers/cloudwatch.js";
import { parseSentryWebhook } from "../src/parsers/sentry.js";
import { isTrustedSubscribeUrl, parseSnsEnvelope } from "../src/parsers/sns.js";
import { alarmMessage, fixture, fixtureJson } from "./helpers.js";

describe("SNS envelope", () => {
  it("reads a notification and keeps the inner message as text", () => {
    const env = parseSnsEnvelope(fixture("sns-cloudwatch-alarm.json"));
    expect(env.type).toBe("Notification");
    if (env.type !== "Notification") return;
    expect(env.topicArn).toBe("arn:aws:sns:eu-central-1:123456789012:alerts-to-slack");
    expect(env.subject).toContain("ALARM");
    expect(JSON.parse(env.message).AlarmName).toBe("checkout-api-5xx-rate");
  });

  it("reads a subscription confirmation", () => {
    const env = parseSnsEnvelope(fixture("sns-subscription-confirmation.json"));
    expect(env).toMatchObject({ type: "SubscriptionConfirmation" });
    if (env.type === "SubscriptionConfirmation") {
      expect(env.subscribeUrl).toMatch(/^https:\/\/sns\.eu-central-1\.amazonaws\.com\/\?Action=ConfirmSubscription/);
    }
  });

  it("rejects bodies that aren't SNS envelopes", () => {
    expect(() => parseSnsEnvelope("not json")).toThrow(PayloadError);
    expect(() => parseSnsEnvelope("[]")).toThrow(PayloadError);
    expect(() => parseSnsEnvelope(JSON.stringify({ Type: "Notification" }))).toThrow(/TopicArn/);
    expect(() => parseSnsEnvelope(JSON.stringify({ Type: "Weird", TopicArn: "arn:x" }))).toThrow(/Unknown SNS/);
  });

  it("only trusts SubscribeURLs on SNS hosts over https", () => {
    expect(isTrustedSubscribeUrl("https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription")).toBe(true);
    expect(isTrustedSubscribeUrl("https://sns.cn-north-1.amazonaws.com.cn/?Action=ConfirmSubscription")).toBe(true);
    expect(isTrustedSubscribeUrl("http://sns.eu-central-1.amazonaws.com/")).toBe(false);
    expect(isTrustedSubscribeUrl("https://sns.eu-central-1.amazonaws.com.evil.example/")).toBe(false);
    expect(isTrustedSubscribeUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isTrustedSubscribeUrl("not a url")).toBe(false);
  });
});

describe("CloudWatch alarm", () => {
  it("turns ALARM into a firing alert", () => {
    const alert = parseCloudWatchAlarm(alarmMessage("sns-cloudwatch-alarm.json"));
    expect(alert).toEqual({
      source: "cloudwatch",
      status: "firing",
      severity: "error",
      service: "checkout-api",
      title: "checkout-api-5xx-rate",
      summary: expect.stringContaining("More than 5% of checkout-api requests"),
      link: "https://eu-central-1.console.aws.amazon.com/cloudwatch/home?region=eu-central-1#alarmsV2:alarm/checkout-api-5xx-rate",
      fingerprint: "cloudwatch:arn:aws:cloudwatch:eu-central-1:123456789012:alarm:checkout-api-5xx-rate",
      occurredAt: "2026-11-10T09:14:03.120Z",
    });
    expect(alert?.summary).toContain("Threshold Crossed");
  });

  it("turns OK after ALARM into a resolved alert with the same fingerprint", () => {
    const firing = parseCloudWatchAlarm(alarmMessage("sns-cloudwatch-alarm.json"));
    const ok = parseCloudWatchAlarm(alarmMessage("sns-cloudwatch-ok.json"));
    expect(ok?.status).toBe("resolved");
    expect(ok?.fingerprint).toBe(firing?.fingerprint);
  });

  it("ignores OK that doesn't follow an ALARM", () => {
    const msg = alarmMessage("sns-cloudwatch-ok.json", { OldStateValue: "INSUFFICIENT_DATA" });
    expect(parseCloudWatchAlarm(msg)).toBeNull();
  });

  it("reports INSUFFICIENT_DATA as a warning", () => {
    const msg = alarmMessage("sns-cloudwatch-alarm.json", { NewStateValue: "INSUFFICIENT_DATA" });
    expect(parseCloudWatchAlarm(msg)).toMatchObject({ status: "firing", severity: "warning" });
  });

  it("falls back to the namespace, then the alarm name, for the service", () => {
    const noDims = alarmMessage("sns-cloudwatch-alarm.json", { Trigger: { Namespace: "AWS/SQS", Dimensions: [] } });
    expect(parseCloudWatchAlarm(noDims)?.service).toBe("AWS/SQS");
    const metricMath = alarmMessage("sns-cloudwatch-alarm.json", { Trigger: { Metrics: [] } });
    expect(parseCloudWatchAlarm(metricMath)?.service).toBe("checkout-api-5xx-rate");
  });

  it("rejects messages without the fields it needs", () => {
    expect(() => parseCloudWatchAlarm(JSON.stringify({ AlarmName: "x" }))).toThrow(/AlarmArn/);
    expect(() => parseCloudWatchAlarm(alarmMessage("sns-cloudwatch-alarm.json", { NewStateValue: "MAYBE" }))).toThrow(
      /Unknown alarm state/,
    );
  });
});

describe("Sentry webhook", () => {
  it("turns a triggered issue alert into a firing alert", () => {
    const alert = parseSentryWebhook("event_alert", fixture("sentry-issue-alert.json"));
    expect(alert).toEqual({
      source: "sentry",
      status: "firing",
      severity: "error",
      service: "web-app",
      title: "TypeError: Cannot read properties of undefined (reading 'discount')",
      summary:
        "Cannot read properties of undefined (reading 'discount')\n" +
        "in submitCoupon(app/checkout/coupon) · production\n" +
        "Rule: New error in production checkout",
      link: "https://sentry.io/organizations/example-org/issues/6012345678/events/5f2b8c1d9e7a4b3c8d6e0f1a2b3c4d5e/",
      fingerprint: "sentry:6012345678",
      occurredAt: "2026-11-10T09:20:41.512000Z",
    });
  });

  it("maps Sentry levels to severities", () => {
    const body = fixtureJson("sentry-issue-alert.json") as { data: { event: { level: string } } };
    body.data.event.level = "fatal";
    expect(parseSentryWebhook("event_alert", JSON.stringify(body))?.severity).toBe("critical");
    body.data.event.level = "warning";
    expect(parseSentryWebhook("event_alert", JSON.stringify(body))?.severity).toBe("warning");
  });

  it("turns a resolved issue into a resolved alert with the same fingerprint", () => {
    const alert = parseSentryWebhook("issue", fixture("sentry-issue-resolved.json"));
    expect(alert).toMatchObject({
      status: "resolved",
      service: "web-app",
      fingerprint: "sentry:6012345678",
      summary: "WEB-APP-3F marked as resolved",
    });
  });

  it("ignores resources and actions it doesn't handle", () => {
    const body = fixtureJson("sentry-issue-resolved.json");
    expect(parseSentryWebhook("issue", JSON.stringify({ ...body, action: "assigned" }))).toBeNull();
    expect(parseSentryWebhook("metric_alert", JSON.stringify({ ...body, action: "critical" }))).toBeNull();
  });

  it("rejects bodies without data", () => {
    expect(() => parseSentryWebhook("event_alert", JSON.stringify({ action: "triggered" }))).toThrow(PayloadError);
  });
});
