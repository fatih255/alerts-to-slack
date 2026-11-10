import { createServer, type Server } from "node:http";
import { renderPreviewPage } from "./preview.js";

export interface ReceivedMessage {
  index: number;
  receivedAt: string;
  payload: unknown;
}

/**
 * A stand-in for a Slack incoming webhook. It stores whatever JSON it gets and serves
 * a local preview page of it. Nothing here talks to Slack.
 */
export function createMockSlack() {
  const messages: ReceivedMessage[] = [];
  let failNext: number | undefined;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/webhook") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (failNext !== undefined) {
          res.writeHead(failNext, { "content-type": "text/plain" }).end("mock failure");
          failNext = undefined;
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          // Slack answers bad JSON with 400 invalid_payload.
          res.writeHead(400, { "content-type": "text/plain" }).end("invalid_payload");
          return;
        }
        messages.push({ index: messages.length + 1, receivedAt: new Date().toISOString(), payload });
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/messages") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(messages, null, 2));
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/messages") {
      messages.length = 0;
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      const only = url.searchParams.get("message");
      const shown = only ? messages.filter((m) => String(m.index) === only) : messages;
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(renderPreviewPage(shown, messages.length, url.searchParams.get("json") !== "0"));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });

  return {
    server,
    messages,
    /** Make the next webhook call fail with this status, to test retries. */
    failNextWith(status: number) {
      failNext = status;
    },
  };
}
