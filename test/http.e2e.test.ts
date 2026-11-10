import type { Server } from "node:http";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockSlack } from "../mock/slack-receiver.js";
import { createApp } from "../src/app.js";
import { signSentryBody } from "../src/auth.js";
import { createHttpServer } from "../src/server.js";
import { fixture } from "./helpers.js";

// Real HTTP on both sides: test -> service -> mock Slack webhook.
// Ports come from the range this repo is allowed to use.
const SERVICE_PORT = 3505;
const MOCK_PORT = 3506;
const service = `http://127.0.0.1:${SERVICE_PORT}`;
const SECRET = "test-shared-secret";
const SENTRY_SECRET = "test-sentry-client-secret";
const WINDOW_MS = 60_000;

let clock = Date.parse("2026-11-10T09:00:00Z");
const confirmed: string[] = [];
const mock = createMockSlack();
let server: Server;

const listen = (s: Server, port: number) => new Promise<void>((r) => s.listen(port, "127.0.0.1", r));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

const app = createApp({
  config: {
    slackWebhookUrl: `http://127.0.0.1:${MOCK_PORT}/webhook`,
    sharedSecret: SECRET,
    sentryClientSecret: SENTRY_SECRET,
    groupWindowMs: WINDOW_MS,
  },
  now: () => clock,
  confirmSubscription: async (url) => {
    confirmed.push(url);
  },
  log: () => {},
});

async function postSns(name: string, headers: Record<string, string> = { "x-alert-secret": SECRET }) {
  const res = await fetch(`${service}/sns`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=UTF-8", ...headers },
    body: fixture(name),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function postSentry(name: string, resource: string, body = fixture(name), secret = SENTRY_SECRET) {
  const res = await fetch(`${service}/sentry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sentry-hook-resource": resource,
      "sentry-hook-signature": signSentryBody(body, secret),
    },
    body,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const received = () => mock.messages.map((m) => (m.payload as { text: string }).text);

beforeAll(async () => {
  await listen(mock.server, MOCK_PORT);
  server = createHttpServer(app);
  await listen(server, SERVICE_PORT);
});

afterAll(async () => {
  await close(server);
  await close(mock.server);
});

beforeEach(() => {
  mock.messages.length = 0;
  clock += 24 * 60 * 60_000; // every test starts well outside earlier windows
});

describe("HTTP handler end to end", () => {
  it("answers health checks", async () => {
    const res = await fetch(`${service}/health`);
    expect(await res.json()).toEqual({ ok: true, groupWindowSeconds: 60 });
  });

  it("groups a Sentry issue and posts the resolved follow-up", async () => {
    expect((await postSentry("sentry-issue-alert.json", "event_alert")).body).toMatchObject({
      result: "posted",
      kind: "new",
    });
    for (let i = 0; i < 3; i++) {
      clock += 5_000;
      expect((await postSentry("sentry-issue-alert.json", "event_alert")).body).toMatchObject({
        result: "suppressed",
      });
    }
    expect(mock.messages).toHaveLength(1);

    clock += WINDOW_MS;
    expect(await app.flush()).toHaveLength(1);

    clock += 60_000;
    expect((await postSentry("sentry-issue-resolved.json", "issue")).body).toMatchObject({ kind: "resolved" });

    expect(received()).toEqual([
      "[Error] Firing: TypeError: Cannot read properties of undefined (reading 'discount') (web-app)",
      "[Error] Still firing (3 more): TypeError: Cannot read properties of undefined (reading 'discount') (web-app)",
      "[Resolved] TypeError: Cannot read properties of undefined (reading 'discount') (web-app)",
    ]);
    // The mock got real Block Kit: header, fields, link button.
    const first = mock.messages[0]!.payload as { blocks: { type: string }[] };
    expect(first.blocks.map((b) => b.type)).toEqual(["header", "section", "section", "actions", "context"]);
  });

  it("posts a CloudWatch alarm and its OK as two messages", async () => {
    await postSns("sns-cloudwatch-alarm.json");
    clock += 18 * 60_000;
    await postSns("sns-cloudwatch-ok.json");
    expect(received()).toEqual([
      "[Error] Firing: checkout-api-5xx-rate (checkout-api)",
      "[Resolved] checkout-api-5xx-rate (checkout-api)",
    ]);
    expect(JSON.stringify(mock.messages[1]!.payload)).toContain("18 min, fired 1 time");
  });

  it("accepts the secret as Basic auth on /sns", async () => {
    const auth = `Basic ${Buffer.from(`alerts:${SECRET}`).toString("base64")}`;
    expect((await postSns("sns-cloudwatch-alarm.json", { authorization: auth })).status).toBe(200);
    expect((await postSns("sns-cloudwatch-ok.json", { authorization: auth })).status).toBe(200);
    expect(mock.messages).toHaveLength(2);
  });

  it("confirms SNS subscriptions without posting to Slack", async () => {
    const res = await postSns("sns-subscription-confirmation.json");
    expect(res).toEqual({
      status: 200,
      body: { result: "confirmed", topicArn: "arn:aws:sns:eu-central-1:123456789012:alerts-to-slack" },
    });
    expect(confirmed.at(-1)).toMatch(/^https:\/\/sns\.eu-central-1\.amazonaws\.com\/\?Action=ConfirmSubscription/);
    expect(mock.messages).toHaveLength(0);
  });

  it("refuses to follow a SubscribeURL that isn't SNS", async () => {
    const body = JSON.parse(fixture("sns-subscription-confirmation.json"));
    body.SubscribeURL = "http://169.254.169.254/latest/meta-data/";
    const before = confirmed.length;
    const res = await fetch(`${service}/sns`, {
      method: "POST",
      headers: { "x-alert-secret": SECRET },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    expect(confirmed).toHaveLength(before);
  });

  it("rejects requests without the right secret or signature", async () => {
    expect((await postSns("sns-cloudwatch-alarm.json", {})).status).toBe(401);
    expect((await postSns("sns-cloudwatch-alarm.json", { "x-alert-secret": "nope" })).status).toBe(401);
    expect((await postSentry("sentry-issue-alert.json", "event_alert", undefined, "wrong-secret")).status).toBe(401);
    expect(mock.messages).toHaveLength(0);
  });

  it("answers 400 for malformed payloads and 404 for unknown routes", async () => {
    const res = await fetch(`${service}/sns`, { method: "POST", headers: { "x-alert-secret": SECRET }, body: "{" });
    expect(res.status).toBe(400);
    expect((await postSentry("x", "event_alert", JSON.stringify({ action: "triggered", data: {} }))).status).toBe(400);
    expect((await fetch(`${service}/nope`)).status).toBe(404);
  });

  it("acknowledges Sentry events it doesn't handle", async () => {
    const body = JSON.stringify({ action: "assigned", data: { issue: {} } });
    expect((await postSentry("x", "issue", body)).body).toMatchObject({ result: "ignored" });
    expect(mock.messages).toHaveLength(0);
  });

  it("returns 502 when Slack fails, so the sender retries, and the retry posts", async () => {
    mock.failNextWith(500);
    expect((await postSns("sns-cloudwatch-alarm.json")).status).toBe(502);
    expect(mock.messages).toHaveLength(0);

    const retry = await postSns("sns-cloudwatch-alarm.json");
    expect(retry.body).toMatchObject({ result: "posted", kind: "new" });
    expect(mock.messages).toHaveLength(1);
  });
});

describe("Lambda handler", () => {
  it("serves a Function URL event and the scheduled flush", async () => {
    process.env.SLACK_WEBHOOK_URL = `http://127.0.0.1:${MOCK_PORT}/webhook`;
    process.env.ALERT_SHARED_SECRET = SECRET;
    process.env.SENTRY_CLIENT_SECRET = SENTRY_SECRET;
    const { handler } = await import("../src/lambda.js");

    const event = {
      rawPath: "/sns",
      headers: { "Content-Type": "text/plain; charset=UTF-8", "X-Alert-Secret": SECRET },
      body: Buffer.from(fixture("sns-cloudwatch-alarm.json")).toString("base64"),
      isBase64Encoded: true,
      requestContext: { http: { method: "POST" } },
    } as unknown as APIGatewayProxyEventV2;

    const res = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body as string)).toMatchObject({ result: "posted", kind: "new" });
    expect(received()).toEqual(["[Error] Firing: checkout-api-5xx-rate (checkout-api)"]);

    const scheduled = { source: "aws.events", "detail-type": "Scheduled Event" } as never;
    expect(await handler(scheduled)).toEqual({ flushed: 0 });
  });
});
