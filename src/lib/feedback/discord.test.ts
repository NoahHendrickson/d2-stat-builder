import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { snowflakeTime, verifyDiscordSignature } from "./discord";
import { verifyGithubSignature } from "./github";
import { createHmac } from "node:crypto";

describe("Discord signatures", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const body = '{"type":1}';
  const now = 1_800_000_000;
  const ts = String(now);
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  it("accepts a signed, fresh interaction", () => {
    expect(verifyDiscordSignature(rawKey, sig, ts, body, now)).toBe(true);
  });
  it("refuses a changed body, an old timestamp, or junk", () => {
    expect(verifyDiscordSignature(rawKey, sig, ts, '{"type":2}', now)).toBe(false);
    expect(verifyDiscordSignature(rawKey, sig, ts, body, now + 3600)).toBe(false);
    expect(verifyDiscordSignature(rawKey, "zz", ts, body, now)).toBe(false);
    expect(verifyDiscordSignature(rawKey, null, ts, body, now)).toBe(false);
  });
  it("reads a snowflake's time", () => {
    // Discord's docs example: 175928847299117063 → 2016-04-30T11:18:25.796Z.
    expect(new Date(snowflakeTime("175928847299117063")).toISOString()).toBe("2016-04-30T11:18:25.796Z");
  });
});

describe("GitHub signatures", () => {
  it("accepts the right HMAC only", () => {
    const body = '{"action":"closed"}';
    const good = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
    expect(verifyGithubSignature("s3cret", body, good)).toBe(true);
    expect(verifyGithubSignature("other", body, good)).toBe(false);
    expect(verifyGithubSignature("s3cret", body, null)).toBe(false);
    expect(verifyGithubSignature("s3cret", body, "sha256=00")).toBe(false);
  });
});
