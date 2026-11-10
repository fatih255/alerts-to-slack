// Local defaults shared by `npm run dev`, `npm run demo` and `npm run screenshots`.
// They match .env.example and only ever point at the local mock webhook.
export const local = {
  servicePort: Number(process.env.PORT ?? 3501),
  mockPort: Number(process.env.MOCK_SLACK_PORT ?? 3502),
  sharedSecret: process.env.ALERT_SHARED_SECRET ?? "local-dev-shared-secret",
  sentryClientSecret: process.env.SENTRY_CLIENT_SECRET ?? "local-dev-sentry-client-secret",
  groupWindowSeconds: Number(process.env.GROUP_WINDOW_SECONDS ?? 10),
};

export const serviceUrl = process.env.SERVICE_URL ?? `http://127.0.0.1:${local.servicePort}`;
export const mockUrl = process.env.MOCK_SLACK_URL ?? `http://127.0.0.1:${local.mockPort}`;
