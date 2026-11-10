export interface Config {
  slackWebhookUrl: string;
  /** Required on /sns (X-Alert-Secret header or Basic auth password). */
  sharedSecret: string;
  /** The Sentry integration's client secret, used to check Sentry-Hook-Signature on /sentry. */
  sentryClientSecret: string;
  groupWindowMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ["SLACK_WEBHOOK_URL", "ALERT_SHARED_SECRET", "SENTRY_CLIENT_SECRET"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const windowSeconds = Number(env.GROUP_WINDOW_SECONDS ?? "300");
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error("GROUP_WINDOW_SECONDS must be a positive number");
  }

  return {
    slackWebhookUrl: env.SLACK_WEBHOOK_URL!,
    sharedSecret: env.ALERT_SHARED_SECRET!,
    sentryClientSecret: env.SENTRY_CLIENT_SECRET!,
    groupWindowMs: windowSeconds * 1000,
  };
}
