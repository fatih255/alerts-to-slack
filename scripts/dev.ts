// Starts the service and the mock Slack webhook side by side.
import { createMockSlack } from "../mock/slack-receiver.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createHttpServer } from "../src/server.js";
import { local, mockUrl, serviceUrl } from "./local-env.js";

const config = loadConfig({
  ...process.env,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ?? `${mockUrl}/webhook`,
  ALERT_SHARED_SECRET: local.sharedSecret,
  SENTRY_CLIENT_SECRET: local.sentryClientSecret,
  GROUP_WINDOW_SECONDS: String(local.groupWindowSeconds),
});

const mock = createMockSlack();
mock.server.listen(local.mockPort, "127.0.0.1", () => {
  console.log(`mock Slack webhook  ${mockUrl}/webhook   preview: ${mockUrl}/`);
});

const app = createApp({ config, log: (m) => console.log(`[service] ${m}`) });
createHttpServer(app).listen(local.servicePort, "127.0.0.1", () => {
  console.log(`alerts-to-slack     ${serviceUrl}  (POST /sns, POST /sentry, GET /health)`);
  console.log(`grouping window     ${local.groupWindowSeconds}s`);
});

// In Lambda an EventBridge schedule does this; locally a timer is enough.
const flushEveryMs = Math.min(30_000, Math.max(1000, (local.groupWindowSeconds * 1000) / 2));
setInterval(() => void app.flush().catch((err) => console.error("[service] flush failed:", err)), flushEveryMs);
