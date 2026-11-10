// Runs the service and mock webhook on their own ports, replays the fixtures on a
// simulated clock, and captures the local preview page with Playwright.
//
// The service gets an injected clock instead of Date.now, so a 5 minute grouping window
// and a resolve 18 minutes later take no real time. Every request still goes over HTTP
// through the real handler, and the page shows the Block Kit JSON the service posted.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createMockSlack } from "../mock/slack-receiver.js";
import { createApp } from "../src/app.js";
import { createHttpServer } from "../src/server.js";
import { senders } from "./demo-lib.js";

const SERVICE_PORT = 3503;
const MOCK_PORT = 3504;
const mockUrl = `http://127.0.0.1:${MOCK_PORT}`;
const serviceUrl = `http://127.0.0.1:${SERVICE_PORT}`;
const sharedSecret = "screenshot-shared-secret";
const sentryClientSecret = "screenshot-sentry-client-secret";
const outDir = "docs/screenshots";

// Simulated time, lined up with the timestamps inside the fixtures.
let clock = 0;
const at = (hhmmss: string) => {
  clock = Date.parse(`2026-11-10T${hhmmss}Z`);
};

const mock = createMockSlack(() => clock);
await new Promise<void>((r) => mock.server.listen(MOCK_PORT, "127.0.0.1", r));

const app = createApp({
  config: {
    slackWebhookUrl: `${mockUrl}/webhook`,
    sharedSecret,
    sentryClientSecret,
    groupWindowMs: 5 * 60_000, // the production default
  },
  now: () => clock,
  log: () => {},
});
const server = createHttpServer(app);
await new Promise<void>((r) => server.listen(SERVICE_PORT, "127.0.0.1", r));

try {
  const { sns, sentry } = senders({ serviceUrl, mockUrl, sharedSecret, sentryClientSecret });

  at("09:14:04");
  await sns("sns-cloudwatch-alarm.json"); // posts: Firing
  at("09:20:42");
  await sentry("sentry-issue-alert.json", "event_alert"); // posts: Firing
  for (const t of ["09:21:35", "09:22:58", "09:24:10", "09:25:21"]) {
    at(t);
    await sentry("sentry-issue-alert.json", "event_alert"); // counted, not posted
  }
  at("09:25:45");
  await app.flush(); // the scheduled flush after the window closes: posts "4 more in the last 5 min"
  at("09:32:06");
  await sns("sns-cloudwatch-ok.json"); // posts: Resolved, open 18 min
  at("09:38:30");
  await sentry("sentry-issue-resolved.json", "issue"); // posts: Resolved

  const texts = mock.messages.map((m) => (m.payload as { text: string }).text);
  const grouped = mock.messages.find((m) => (m.payload as { text: string }).text.includes("Still firing"));
  const resolved = mock.messages.find((m) => {
    const text = (m.payload as { text: string }).text;
    return text.startsWith("[Resolved]") && text.includes("checkout-api");
  });
  if (!grouped || !resolved) throw new Error(`expected a grouped and a resolved message, got: ${texts.join(" | ")}`);

  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  const shots: [string, string][] = [
    [`${mockUrl}/?message=${grouped.index}`, "grouped-alert.png"],
    [`${mockUrl}/?message=${resolved.index}`, "resolved-alert.png"],
    [`${mockUrl}/?json=0`, "all-messages.png"],
  ];
  for (const [url, file] of shots) {
    await page.goto(url);
    await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
    console.log(`saved ${outDir}/${file}`);
  }
  await browser.close();
} finally {
  server.close();
  mock.server.close();
}
