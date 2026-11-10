import { PayloadError } from "../model.js";
import { parseJson, requireString } from "../util.js";

/**
 * The SNS HTTP/S delivery envelope. SNS posts this as text/plain and also sets
 * the x-amz-sns-message-type header. See "Parsing Amazon SNS message formats" in the SNS docs.
 */
export type SnsEnvelope =
  | { type: "SubscriptionConfirmation"; topicArn: string; subscribeUrl: string }
  | { type: "UnsubscribeConfirmation"; topicArn: string }
  | { type: "Notification"; topicArn: string; subject?: string; message: string };

export function parseSnsEnvelope(body: string): SnsEnvelope {
  const json = parseJson(body, "SNS body");
  const type = requireString(json, "Type", "SNS body");
  const topicArn = requireString(json, "TopicArn", "SNS body");

  switch (type) {
    case "SubscriptionConfirmation":
      return { type, topicArn, subscribeUrl: requireString(json, "SubscribeURL", "SNS body") };
    case "UnsubscribeConfirmation":
      return { type, topicArn };
    case "Notification": {
      const subject = typeof json.Subject === "string" ? json.Subject : undefined;
      return { type, topicArn, subject, message: requireString(json, "Message", "SNS body") };
    }
    default:
      throw new PayloadError(`Unknown SNS message type "${type}"`);
  }
}

/**
 * Only follow SubscribeURLs that point at SNS itself. Without this check anyone who
 * knows the secret could make the service fetch an arbitrary URL.
 */
export function isTrustedSubscribeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname);
}
