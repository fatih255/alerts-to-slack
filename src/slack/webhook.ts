import type { SlackMessage } from "./blocks.js";

export class SlackPostError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SlackPostError";
  }
}

/** Posts one message to a Slack incoming webhook (or anything that speaks the same protocol). */
export async function postToWebhook(webhookUrl: string, message: SlackMessage, timeoutMs = 5000): Promise<void> {
  let res: Response;
  try {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new SlackPostError(`Webhook request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new SlackPostError(`Webhook answered ${res.status}: ${detail}`, res.status);
  }
}
