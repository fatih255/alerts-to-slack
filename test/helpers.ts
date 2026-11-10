import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NormalizedAlert } from "../src/model.js";

const dir = fileURLToPath(new URL("../fixtures/", import.meta.url));

export const fixture = (name: string) => readFileSync(`${dir}${name}`, "utf8");
export const fixtureJson = (name: string) => JSON.parse(fixture(name)) as Record<string, unknown>;

/** The CloudWatch alarm JSON inside an SNS fixture, optionally changed. */
export function alarmMessage(name: string, patch: Record<string, unknown> = {}): string {
  const envelope = fixtureJson(name) as { Message: string };
  return JSON.stringify({ ...JSON.parse(envelope.Message), ...patch });
}

export function makeAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    source: "sentry",
    status: "firing",
    severity: "error",
    service: "web-app",
    title: "TypeError: x is undefined",
    summary: "x is undefined\nin render(app/page) · production",
    link: "https://sentry.io/organizations/example-org/issues/1/",
    fingerprint: "sentry:1",
    occurredAt: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}
