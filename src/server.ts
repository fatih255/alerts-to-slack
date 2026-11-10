import { createServer, type IncomingMessage, type Server } from "node:http";
import type { App } from "./app.js";

const MAX_BODY_BYTES = 256 * 1024;

/** Runs the app as a plain Node HTTP server, for local use and the end-to-end tests. */
export function createHttpServer(app: App): Server {
  return createServer(async (req, res) => {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413, { "content-type": "application/json" }).end('{"error":"body too large"}');
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
    }
    const out = await app.handle({ method: req.method ?? "GET", path: url.pathname, headers, body });
    res.writeHead(out.statusCode, out.headers).end(out.body);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
