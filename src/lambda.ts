import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, ScheduledEvent } from "aws-lambda";
import { createApp, type App } from "./app.js";
import { loadConfig } from "./config.js";

// Created once per container. The in-memory store means grouping only spans one
// warm container; see Limits in the README.
let app: App | undefined;

/**
 * Lambda entry point for a Function URL or an API Gateway HTTP API (payload v2),
 * plus an EventBridge schedule that flushes grouped counts.
 */
export async function handler(
  event: APIGatewayProxyEventV2 | ScheduledEvent,
): Promise<APIGatewayProxyResultV2 | { flushed: number }> {
  app ??= createApp({ config: loadConfig() });

  if ("source" in event && event.source === "aws.events") {
    const posted = await app.flush();
    return { flushed: posted.length };
  }

  const http = event as APIGatewayProxyEventV2;
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(http.headers ?? {})) headers[key.toLowerCase()] = value;
  const body = http.body
    ? http.isBase64Encoded
      ? Buffer.from(http.body, "base64").toString("utf8")
      : http.body
    : "";

  return app.handle({
    method: http.requestContext.http.method,
    path: http.rawPath,
    headers,
    body,
  });
}
