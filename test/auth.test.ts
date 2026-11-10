import { describe, expect, it } from "vitest";
import { hasSharedSecret, hasValidSentrySignature, signSentryBody } from "../src/auth.js";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("shared secret", () => {
  it("accepts the X-Alert-Secret header", () => {
    expect(hasSharedSecret({ "x-alert-secret": "s3cret" }, "s3cret")).toBe(true);
    expect(hasSharedSecret({ "x-alert-secret": "s3cre" }, "s3cret")).toBe(false);
    expect(hasSharedSecret({ "x-alert-secret": "" }, "s3cret")).toBe(false);
  });

  it("accepts the password of HTTP Basic auth, which is how SNS can send it", () => {
    expect(hasSharedSecret({ authorization: basic("alerts", "s3cret") }, "s3cret")).toBe(true);
    expect(hasSharedSecret({ authorization: basic("alerts", "wrong") }, "s3cret")).toBe(false);
    expect(hasSharedSecret({ authorization: `Basic ${Buffer.from("s3cret").toString("base64")}` }, "s3cret")).toBe(
      false,
    );
    expect(hasSharedSecret({ authorization: "Bearer s3cret" }, "s3cret")).toBe(false);
  });

  it("rejects requests with neither", () => {
    expect(hasSharedSecret({}, "s3cret")).toBe(false);
  });
});

describe("Sentry signature", () => {
  const body = '{"action":"triggered"}';

  it("accepts an HMAC-SHA256 of the raw body", () => {
    const signature = signSentryBody(body, "client-secret");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(hasValidSentrySignature({ "sentry-hook-signature": signature }, body, "client-secret")).toBe(true);
  });

  it("rejects a changed body, wrong secret or missing header", () => {
    const signature = signSentryBody(body, "client-secret");
    expect(hasValidSentrySignature({ "sentry-hook-signature": signature }, `${body} `, "client-secret")).toBe(false);
    expect(hasValidSentrySignature({ "sentry-hook-signature": signature }, body, "other")).toBe(false);
    expect(hasValidSentrySignature({}, body, "client-secret")).toBe(false);
  });
});
