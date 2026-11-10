import type { ReceivedMessage } from "./slack-receiver.js";

/**
 * Renders received Block Kit payloads as plain HTML next to their raw JSON.
 * It's a local debugging view, deliberately not styled to look like Slack.
 */
export function renderPreviewPage(messages: ReceivedMessage[], total: number, showJson = true): string {
  const cards = messages.length
    ? `<div class="${showJson ? "list" : "list compact"}">${messages.map((m) => renderCard(m, showJson)).join("\n")}</div>`
    : `<p class="empty">No messages yet. Start the service with <code>npm run dev</code> and run <code>npm run demo</code>.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Local message preview</title>
<style>
  :root { --ink: #1d2430; --muted: #5b6575; --line: #d9dee6; --bg: #f5f7fa; --card: #fff; --accent: #2457c5; --quote: #c9d1dc; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 28px 24px 40px; }
  .banner { border: 1px dashed var(--muted); border-radius: 6px; padding: 10px 14px; color: var(--muted); font-size: 13px; background: #fff; }
  .banner strong { color: var(--ink); }
  h1 { font-size: 20px; margin: 18px 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; font-size: 13px; }
  .card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px; overflow: hidden; }
  .card > header { grid-column: 1 / -1; padding: 8px 16px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; }
  .render { padding: 16px 18px; border-right: 1px solid var(--line); }
  .json { margin: 0; padding: 14px 16px; background: #fbfcfd; font: 11.5px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
  .fallback { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
  .b-header { font-size: 17px; font-weight: 700; margin: 0 0 10px; }
  .b-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin-bottom: 10px; }
  .b-section { margin-bottom: 10px; }
  .b-section blockquote { margin: 0; padding-left: 10px; border-left: 3px solid var(--quote); color: #333b47; }
  .b-actions { margin: 4px 0 10px; }
  .b-actions a { display: inline-block; padding: 5px 12px; border: 1px solid var(--accent); color: var(--accent); border-radius: 5px; text-decoration: none; font-size: 14px; font-weight: 600; }
  .b-context { font-size: 12.5px; color: var(--muted); }
  code { font: 12px ui-monospace, Consolas, monospace; background: #eef1f5; padding: 1px 4px; border-radius: 3px; }
  .empty { color: var(--muted); }
  .compact { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .compact .card { grid-template-columns: minmax(0, 1fr); margin-bottom: 0; }
  .compact .render { border-right: 0; }
</style>
</head>
<body>
<main>
  <div class="banner"><strong>Local preview, not Slack.</strong> This page renders the exact Block Kit JSON that the mock webhook receiver got from alerts-to-slack. ${showJson ? "Left: a plain rendering of the blocks. Right: the payload as received." : "Open a single message (<code>?message=N</code>) to see its raw JSON next to the rendering."}</div>
  <h1>Local message preview</h1>
  <p class="sub">Showing ${messages.length} of ${total} message${total === 1 ? "" : "s"} received by the mock webhook.</p>
  ${cards}
</main>
</body>
</html>`;
}

function renderCard(message: ReceivedMessage, showJson: boolean): string {
  const payload = (message.payload ?? {}) as { text?: unknown; blocks?: unknown };
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
  return `<section class="card" data-index="${message.index}">
  <header><span>Message #${message.index}</span><span>received ${html(message.receivedAt)}</span></header>
  <div class="render">
    ${typeof payload.text === "string" ? `<div class="fallback">Fallback text: ${mrkdwn(payload.text)}</div>` : ""}
    ${blocks.map(renderBlock).join("\n")}
  </div>
  ${showJson ? `<pre class="json">${html(JSON.stringify(message.payload, null, 2))}</pre>` : ""}
</section>`;
}

type AnyBlock = {
  type?: string;
  text?: { text?: string };
  fields?: { text?: string }[];
  elements?: { type?: string; text?: string | { text?: string }; url?: string }[];
};

function renderBlock(raw: unknown): string {
  const block = raw as AnyBlock;
  switch (block.type) {
    case "header":
      return `<div class="b-header">${html(block.text?.text ?? "")}</div>`;
    case "section": {
      const text = block.text?.text ? `<div class="b-section">${mrkdwn(block.text.text)}</div>` : "";
      const fields = block.fields?.length
        ? `<div class="b-fields">${block.fields.map((f) => `<div>${mrkdwn(f.text ?? "")}</div>`).join("")}</div>`
        : "";
      return text + fields;
    }
    case "actions":
      return `<div class="b-actions">${(block.elements ?? [])
        .filter((e) => e.type === "button")
        .map((e) => {
          const label = typeof e.text === "object" ? (e.text.text ?? "") : "";
          return `<a href="${html(e.url ?? "#")}" rel="noreferrer">${html(label)}</a>`;
        })
        .join(" ")}</div>`;
    case "context":
      return `<div class="b-context">${(block.elements ?? [])
        .map((e) => mrkdwn(typeof e.text === "string" ? e.text : ""))
        .join(" ")}</div>`;
    default:
      return `<div class="b-context">Unsupported block type: ${html(String(block.type))}</div>`;
  }
}

/** Enough of Slack mrkdwn for this service's messages: *bold*, _italic_, `code`, > quotes. */
function mrkdwn(text: string): string {
  const decoded = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const lines = decoded.split("\n");
  const out: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
    quote = [];
  };
  for (const line of lines) {
    if (line.startsWith("> ")) {
      quote.push(inline(line.slice(2)));
    } else {
      flush();
      out.push(inline(line));
    }
  }
  flush();
  return out.join("<br>").replace(/<br>(<blockquote>)/g, "$1").replace(/(<\/blockquote>)<br>/g, "$1");
}

function inline(text: string): string {
  return html(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<em>$2</em>");
}

function html(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
