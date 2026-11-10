// Runs the service and mock webhook on their own ports, sends the demo fixtures,
// and captures the local preview page with Playwright.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createMockSlack } from "../mock/slack-receiver.js";
import { createApp } from "../src/app.js";
import { createHttpServer } from "../src/server.js";
import { runDemo } from "./demo-lib.js";

const SERVICE_PORT = 3503;
const MOCK_PORT = 3504;
const sharedSecret = "screenshot-shared-secret";
const sentryClientSecret = "screenshot-sentry-client-secret";
const mockUrl = `http://127.0.0.1:${MOCK_PORT}`;
const serviceUrl = `http://127.0.0.1:${SERVICE_PORT}`;
const outDir = "docs/screenshots";

const mock = createMockSlack();
await new Promise<void>((r) => mock.server.listen(MOCK_PORT, "127.0.0.1", r));

const app = createApp({
  config: {
    slackWebhookUrl: `${mockUrl}/webhook`,
    sharedSecret,
    sentryClientSecret,
    groupWindowMs: 2000,
  },
  log: () => {},
});
const server = createHttpServer(app);
await new Promise<void>((r) => server.listen(SERVICE_PORT, "127.0.0.1", r));
const timer = setInterval(() => void app.flush(), 500);

try {
  await runDemo({ serviceUrl, mockUrl, sharedSecret, sentryClientSecret });

  const kinds = mock.messages.map((m) => (m.payload as { text: string }).text);
  const grouped = mock.messages.find((m) => (m.payload as { text: string }).text.includes("Still firing"));
  const resolved = mock.messages.find((m) => {
    const text = (m.payload as { text: string }).text;
    return text.startsWith("[Resolved]") && text.includes("checkout-api");
  });
  if (!grouped || !resolved) throw new Error(`expected a grouped and a resolved message, got: ${kinds.join(" | ")}`);

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
  clearInterval(timer);
  server.close();
  mock.server.close();
}
