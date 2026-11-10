import { PayloadError, type NormalizedAlert } from "../model.js";
import { isObject, optionalString, parseJson, requireString, truncate } from "../util.js";

// Dimensions that usually name the thing a person cares about, in order of preference.
const SERVICE_DIMENSIONS = [
  "FunctionName",
  "ServiceName",
  "ApiName",
  "DBInstanceIdentifier",
  "QueueName",
  "TableName",
  "LoadBalancer",
];

/**
 * Parses the JSON CloudWatch puts in the SNS "Message" field when an alarm changes state.
 * Returns null for transitions nobody needs to hear about (OK after INSUFFICIENT_DATA).
 */
export function parseCloudWatchAlarm(messageText: string): NormalizedAlert | null {
  const msg = parseJson(messageText, "CloudWatch alarm message");
  const name = requireString(msg, "AlarmName", "CloudWatch alarm");
  const arn = requireString(msg, "AlarmArn", "CloudWatch alarm");
  const newState = requireString(msg, "NewStateValue", "CloudWatch alarm");
  const oldState = optionalString(msg, "OldStateValue");
  const reason = optionalString(msg, "NewStateReason") ?? "";
  const description = optionalString(msg, "AlarmDescription");
  const occurredAt = optionalString(msg, "StateChangeTime") ?? new Date().toISOString();

  if (newState === "OK" && oldState !== "ALARM") return null;
  if (newState !== "OK" && newState !== "ALARM" && newState !== "INSUFFICIENT_DATA") {
    throw new PayloadError(`Unknown alarm state "${newState}"`);
  }

  // arn:aws:cloudwatch:<region>:<account>:alarm:<name>
  const region = arn.split(":")[3];
  if (!region) throw new PayloadError("AlarmArn has no region");

  const summaryParts = [description, reason].filter((part): part is string => Boolean(part));

  return {
    source: "cloudwatch",
    status: newState === "OK" ? "resolved" : "firing",
    severity: newState === "INSUFFICIENT_DATA" ? "warning" : "error",
    service: serviceFromTrigger(msg.Trigger) ?? name,
    title: name,
    summary: truncate(summaryParts.join("\n"), 500),
    link:
      `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}` +
      `#alarmsV2:alarm/${encodeURIComponent(name)}`,
    fingerprint: `cloudwatch:${arn}`,
    occurredAt: normalizeTimestamp(occurredAt),
  };
}

function serviceFromTrigger(trigger: unknown): string | undefined {
  if (!isObject(trigger)) return undefined;
  const dims = Array.isArray(trigger.Dimensions) ? trigger.Dimensions.filter(isObject) : [];
  for (const wanted of SERVICE_DIMENSIONS) {
    const hit = dims.find((d) => d.name === wanted && typeof d.value === "string");
    if (hit) return hit.value as string;
  }
  const first = dims.find((d) => typeof d.value === "string");
  if (first) return first.value as string;
  return typeof trigger.Namespace === "string" ? trigger.Namespace : undefined;
}

// CloudWatch sends "2026-11-10T09:14:03.120+0000"; Date.parse wants "+00:00".
function normalizeTimestamp(value: string): string {
  const fixed = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(fixed);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}
