import type { Notification } from "../grouping/grouper.js";
import type { NormalizedAlert, Severity } from "../model.js";
import { truncate } from "../util.js";

/** The subset of Block Kit this service sends. */
export type Block =
  | { type: "header"; text: { type: "plain_text"; text: string } }
  | { type: "section"; text?: Mrkdwn; fields?: Mrkdwn[] }
  | {
      type: "actions";
      elements: { type: "button"; text: { type: "plain_text"; text: string }; url: string; action_id: string }[];
    }
  | { type: "context"; elements: Mrkdwn[] };

type Mrkdwn = { type: "mrkdwn"; text: string };

export interface SlackMessage {
  /** Fallback for notifications and clients that can't show blocks. */
  text: string;
  blocks: Block[];
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const SOURCE_LABEL = { cloudwatch: "CloudWatch", sentry: "Sentry" } as const;

// Slack limits: header text 150 chars, section text 3000, field text 2000.
const HEADER_MAX = 150;

const TRIAGE_LINE = "Triage: reproduce it first · tell CS before the hotfix · tell them again when it's live";
const RESOLVED_LINE = "If CS heard about this one, let them know the fix is live.";

export function buildMessage(notification: Notification, now: number): SlackMessage {
  const { alert } = notification;
  switch (notification.kind) {
    case "new":
      return {
        text: fallback("Firing", alert),
        blocks: [
          header("Firing", alert.title),
          fields([
            ["Severity", SEVERITY_LABEL[alert.severity]],
            ["Service", alert.service],
            ["Source", SOURCE_LABEL[alert.source]],
            ["Happened", formatTime(Date.parse(alert.occurredAt))],
          ]),
          ...summary(alert),
          linkButton(alert),
          context(TRIAGE_LINE),
        ],
      };
    case "repeat": {
      const { count, totalCount, windowStartedAt, firstSeenAt } = notification;
      return {
        text: fallback(`Still firing (${count} more)`, alert),
        blocks: [
          header("Still firing", alert.title),
          fields([
            ["Severity", SEVERITY_LABEL[alert.severity]],
            ["Service", alert.service],
            ["Source", SOURCE_LABEL[alert.source]],
            ["Count", `${count} more in the last ${formatDuration(now - windowStartedAt)} (${totalCount} total)`],
          ]),
          ...summary(alert),
          linkButton(alert),
          context(`Grouped by fingerprint \`${escape(alert.fingerprint)}\` · first seen ${formatTime(firstSeenAt)}`),
        ],
      };
    }
    case "resolved": {
      const { history } = notification;
      const openFor = history
        ? `${formatDuration(now - history.firstSeenAt)}, fired ${plural(history.totalCount, "time")}`
        : "No firing alert on record";
      return {
        text: escape(`[Resolved] ${alert.title} (${alert.service})`),
        blocks: [
          header("Resolved", alert.title),
          fields([
            ["Service", alert.service],
            ["Source", SOURCE_LABEL[alert.source]],
            ["Open for", openFor],
          ]),
          ...summary(alert),
          linkButton(alert),
          context(RESOLVED_LINE),
        ],
      };
    }
  }
}

function header(prefix: string, title: string): Block {
  return { type: "header", text: { type: "plain_text", text: truncate(`${prefix}: ${title}`, HEADER_MAX) } };
}

function fields(pairs: [string, string][]): Block {
  return {
    type: "section",
    fields: pairs.map(([label, value]) => ({ type: "mrkdwn", text: `*${label}*\n${escape(value)}` })),
  };
}

function summary(alert: NormalizedAlert): Block[] {
  if (!alert.summary) return [];
  const quoted = escape(alert.summary)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return [{ type: "section", text: { type: "mrkdwn", text: quoted } }];
}

function linkButton(alert: NormalizedAlert): Block {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: `Open in ${SOURCE_LABEL[alert.source]}` },
        url: alert.link,
        action_id: "open_source",
      },
    ],
  };
}

function context(text: string): Block {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

function fallback(prefix: string, alert: NormalizedAlert): string {
  // Slack parses the top-level text as mrkdwn too, so it needs the same escaping.
  return escape(`[${SEVERITY_LABEL[alert.severity]}] ${prefix}: ${alert.title} (${alert.service})`);
}

/** Slack mrkdwn treats &, < and > as control characters. */
export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatTime(ms: number): string {
  if (Number.isNaN(ms)) return "unknown";
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.toISOString().slice(0, 10)} ${hh}:${mm} UTC`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
