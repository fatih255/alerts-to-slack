/** The one shape every parser produces. Slack formatting and grouping only see this. */
export type AlertSource = "cloudwatch" | "sentry";
export type Severity = "critical" | "error" | "warning" | "info";
export type AlertStatus = "firing" | "resolved";

export interface NormalizedAlert {
  source: AlertSource;
  status: AlertStatus;
  severity: Severity;
  /** Which service or project the alert is about, e.g. a Lambda function name or Sentry project slug. */
  service: string;
  title: string;
  /** One or two lines a person can read in Slack without opening the link. */
  summary: string;
  link: string;
  /** Alerts with the same fingerprint are the same problem and get grouped. */
  fingerprint: string;
  /** When the source says it happened (ISO 8601). Display only; grouping uses receive time. */
  occurredAt: string;
}

export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}
