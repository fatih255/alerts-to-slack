import { PayloadError, type NormalizedAlert, type Severity } from "../model.js";
import { isObject, optionalString, parseJson, requireString, truncate, type Json } from "../util.js";

const LEVELS: Record<string, Severity> = {
  fatal: "critical",
  error: "error",
  warning: "warning",
  info: "info",
  debug: "info",
};

/**
 * Parses a Sentry integration webhook. The resource comes from the Sentry-Hook-Resource header:
 * - "event_alert" with action "triggered": an issue alert rule fired for an event
 * - "issue" with action "resolved": someone (or a release) resolved the issue
 * Other resources and actions return null and are acknowledged without posting.
 */
export function parseSentryWebhook(resource: string | undefined, body: string): NormalizedAlert | null {
  const json = parseJson(body, "Sentry body");
  const action = requireString(json, "action", "Sentry body");
  const data = json.data;
  if (!isObject(data)) throw new PayloadError("Sentry body.data must be an object");

  if (resource === "event_alert" && action === "triggered") return fromEventAlert(data);
  if (resource === "issue" && action === "resolved") return fromResolvedIssue(data);
  return null;
}

function fromEventAlert(data: Json): NormalizedAlert {
  const event = data.event;
  if (!isObject(event)) throw new PayloadError("Sentry data.event must be an object");

  const issueId = requireString(event, "issue_id", "Sentry event");
  const metadata = isObject(event.metadata) ? event.metadata : {};
  const culprit = optionalString(event, "culprit");
  const environment = optionalString(event, "environment");
  const rule = optionalString(data, "triggered_rule");

  const summary = [
    optionalString(metadata, "value"),
    [culprit && `in ${culprit}`, environment].filter(Boolean).join(" · "),
    rule && `Rule: ${rule}`,
  ].filter((line): line is string => Boolean(line));

  return {
    source: "sentry",
    status: "firing",
    severity: LEVELS[optionalString(event, "level") ?? "error"] ?? "error",
    service: projectFromApiUrl(optionalString(event, "url")) ?? "unknown project",
    title: requireString(event, "title", "Sentry event"),
    summary: truncate(summary.join("\n"), 500),
    link: requireString(event, "web_url", "Sentry event"),
    fingerprint: `sentry:${issueId}`,
    occurredAt: optionalString(event, "datetime") ?? new Date().toISOString(),
  };
}

function fromResolvedIssue(data: Json): NormalizedAlert {
  const issue = data.issue;
  if (!isObject(issue)) throw new PayloadError("Sentry data.issue must be an object");
  const project = isObject(issue.project) ? issue.project : {};
  const shortId = optionalString(issue, "shortId");

  return {
    source: "sentry",
    status: "resolved",
    severity: LEVELS[optionalString(issue, "level") ?? "error"] ?? "error",
    service: optionalString(project, "slug") ?? "unknown project",
    title: requireString(issue, "title", "Sentry issue"),
    summary: shortId ? `${shortId} marked as resolved` : "Marked as resolved",
    link: requireString(issue, "web_url", "Sentry issue"),
    fingerprint: `sentry:${requireString(issue, "id", "Sentry issue")}`,
    occurredAt: optionalString(issue, "lastSeen") ?? new Date().toISOString(),
  };
}

// https://sentry.io/api/0/projects/<org>/<project>/events/<id>/
function projectFromApiUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /\/projects\/[^/]+\/([^/]+)\//.exec(url)?.[1];
}
