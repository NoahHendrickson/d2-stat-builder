import { test, expect } from "vitest";
import { decodeSigned, encodeSigned } from "./signed-cookie";

const SECRET = "test-secret";

test("round-trips a JSON value", async () => {
  const value = { membershipId: "123", displayName: "Noah#0001" };
  const raw = await encodeSigned(value, SECRET);
  expect(raw).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(await decodeSigned(raw, SECRET)).toEqual(value);
});

test("rejects a tampered payload", async () => {
  const raw = await encodeSigned({ membershipId: "123" }, SECRET);
  const [, sig] = raw.split(".");
  const forged = await encodeSigned({ membershipId: "999" }, "other");
  const [forgedPayload] = forged.split(".");
  expect(await decodeSigned(`${forgedPayload}.${sig}`, SECRET)).toBeNull();
});

test("rejects the wrong secret", async () => {
  const raw = await encodeSigned({ membershipId: "123" }, SECRET);
  expect(await decodeSigned(raw, "nope")).toBeNull();
});

test("rejects legacy unsigned JSON and garbage", async () => {
  expect(await decodeSigned(JSON.stringify({ membershipId: "1" }), SECRET)).toBeNull();
  expect(await decodeSigned("", SECRET)).toBeNull();
  expect(await decodeSigned(undefined, SECRET)).toBeNull();
  expect(await decodeSigned("a.b", SECRET)).toBeNull();
  expect(await decodeSigned("no-dot", SECRET)).toBeNull();
});
