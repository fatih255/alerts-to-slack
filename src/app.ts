import { hasSharedSecret, hasValidSentrySignature } from "./auth.js";
import type { Config } from "./config.js";
import { Grouper, type Outcome, type Send } from "./grouping/grouper.js";
import { MemoryStore, type AlertStore } from "./grouping/store.js";
import { PayloadError, type NormalizedAlert } from "./model.js";
import { parseCloudWatchAlarm } from "./parsers/cloudwatch.js";
import { parseSentryWebhook } from "./parsers/sentry.js";
import { isTrustedSubscribeUrl, parseSnsEnvelope } from "./parsers/sns.js";
import { buildMessage } from "./slack/blocks.js";
import { postToWebhook, SlackPostError } from "./slack/webhook.js";

/** Transport-neutral request: the HTTP server and the Lambda handler both map to this. */
export interface AppRequest {
  method: string;
  path: string;
  /** Lowercased header names. */
  headers: Record<string, string | undefined>;
  body: string;
}

export interface AppResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface AppDeps {
  config: Config;
  store?: AlertStore;
  now?: () => number;
  send?: Send;
  /** Visits the SNS SubscribeURL. Injected in tests so nothing calls AWS. */
  confirmSubscription?: (url: string) => Promise<void>;
  log?: (message: string) => void;
}

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const grouper = new Grouper(deps.store ?? new MemoryStore(), config.groupWindowMs);
  const send: Send =
    deps.send ?? ((notification, at) => postToWebhook(config.slackWebhookUrl, buildMessage(notification, at)));
  const confirmSubscription = deps.confirmSubscription ?? defaultConfirm;

  async function deliver(alert: NormalizedAlert): Promise<AppResponse> {
    const outcome: Outcome = await grouper.handle(alert, now(), send);
    if ("posted" in outcome) {
      log(`posted ${outcome.posted.kind} ${alert.fingerprint}`);
      return json(200, { result: "posted", kind: outcome.posted.kind, fingerprint: alert.fingerprint });
    }
    log(`suppressed ${alert.fingerprint} (${outcome.suppressed.pendingCount} pending)`);
    return json(200, { result: "suppressed", ...outcome.suppressed });
  }

  async function handleSns(req: AppRequest): Promise<AppResponse> {
    if (!hasSharedSecret(req.headers, config.sharedSecret)) return json(401, { error: "bad or missing secret" });

    const envelope = parseSnsEnvelope(req.body);
    switch (envelope.type) {
      case "SubscriptionConfirmation":
        if (!isTrustedSubscribeUrl(envelope.subscribeUrl)) {
          return json(400, { error: "SubscribeURL is not an SNS endpoint" });
        }
        await confirmSubscription(envelope.subscribeUrl);
        log(`confirmed SNS subscription for ${envelope.topicArn}`);
        return json(200, { result: "confirmed", topicArn: envelope.topicArn });
      case "UnsubscribeConfirmation":
        return json(200, { result: "ignored", reason: "unsubscribe confirmation" });
      case "Notification": {
        const alert = parseCloudWatchAlarm(envelope.message);
        if (!alert) return json(200, { result: "ignored", reason: "state change not worth a message" });
        return deliver(alert);
      }
    }
  }

  async function handleSentry(req: AppRequest): Promise<AppResponse> {
    if (!hasValidSentrySignature(req.headers, req.body, config.sentryClientSecret)) {
      return json(401, { error: "bad or missing Sentry-Hook-Signature" });
    }
    const alert = parseSentryWebhook(req.headers["sentry-hook-resource"], req.body);
    if (!alert) return json(200, { result: "ignored", reason: "resource or action not handled" });
    return deliver(alert);
  }

  async function handle(req: AppRequest): Promise<AppResponse> {
    try {
      if (req.method === "GET" && req.path === "/health") {
        return json(200, { ok: true, groupWindowSeconds: config.groupWindowMs / 1000 });
      }
      if (req.method === "POST" && req.path === "/sns") return await handleSns(req);
      if (req.method === "POST" && req.path === "/sentry") return await handleSentry(req);
      return json(404, { error: "not found" });
    } catch (err) {
      if (err instanceof PayloadError) return json(400, { error: err.message });
      // 502 makes SNS and Sentry retry later, when Slack may be back.
      if (err instanceof SlackPostError) return json(502, { error: err.message });
      log(`unexpected error: ${(err as Error).stack ?? err}`);
      return json(500, { error: "internal error" });
    }
  }

  async function flush() {
    const posted = await grouper.flush(now(), send);
    for (const n of posted) log(`posted ${n.kind} ${n.alert.fingerprint}`);
    return posted;
  }

  return { handle, flush };
}

export type App = ReturnType<typeof createApp>;

async function defaultConfirm(url: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`SubscribeURL answered ${res.status}`);
}

function json(statusCode: number, body: unknown): AppResponse {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
