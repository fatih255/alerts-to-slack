import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { signSentryBody } from "../src/auth.js";

const fixtureDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
export const fixture = (name: string) => readFileSync(`${fixtureDir}${name}`, "utf8");

interface Target {
  serviceUrl: string;
  mockUrl: string;
  sharedSecret: string;
  sentryClientSecret: string;
  log?: (line: string) => void;
}

/**
 * Sends the fixtures through a running service the way SNS and Sentry would:
 * a Sentry issue that fires five times, a CloudWatch alarm, then both resolve.
 */
export async function runDemo(t: Target) {
  const log = t.log ?? console.log;

  const health = (await (await fetch(`${t.serviceUrl}/health`)).json()) as { groupWindowSeconds: number };
  await fetch(`${t.mockUrl}/messages`, { method: "DELETE" });

  const sns = async (name: string) => {
    const res = await fetch(`${t.serviceUrl}/sns`, {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=UTF-8",
        "x-amz-sns-message-type": "Notification",
        "x-alert-secret": t.sharedSecret,
      },
      body: fixture(name),
    });
    log(`POST /sns     ${name.padEnd(32)} ${res.status} ${await res.text()}`);
  };

  const sentry = async (name: string, resource: string) => {
    const body = fixture(name);
    const res = await fetch(`${t.serviceUrl}/sentry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sentry-hook-resource": resource,
        "sentry-hook-signature": signSentryBody(body, t.sentryClientSecret),
      },
      body,
    });
    log(`POST /sentry  ${name.padEnd(32)} ${res.status} ${await res.text()}`);
  };

  for (let i = 0; i < 5; i++) await sentry("sentry-issue-alert.json", "event_alert");
  await sns("sns-cloudwatch-alarm.json");

  log(`waiting for the ${health.groupWindowSeconds}s grouping window to close...`);
  await waitFor(async () => {
    const messages = (await (await fetch(`${t.mockUrl}/messages`)).json()) as unknown[];
    return messages.length >= 3;
  }, health.groupWindowSeconds * 1000 * 3 + 5000);

  await sns("sns-cloudwatch-ok.json");
  await sentry("sentry-issue-resolved.json", "issue");

  log(`done. preview: ${t.mockUrl}/`);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error("timed out waiting for the grouped message; is the service flushing?");
}
