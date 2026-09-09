import { test, expect, describe } from "vitest";
import {
  applyStreamEvent,
  finishKind,
  itemStepId,
  parseApplyStreamEvent,
  plugStepId,
  readNdjsonLines,
  type ApplyStep,
} from "./apply-progress";

const step = (id: string, status: ApplyStep["status"] = "pending"): ApplyStep => ({
  id,
  name: id,
  status,
});

describe("applyStreamEvent", () => {
  const items = [step(itemStepId("helm")), step(plugStepId({ itemInstanceId: "helm", socketIndex: 1, plugItemHash: 9 }))];

  test("marks an item active, then ok or fail", () => {
    const active = applyStreamEvent(items, { type: "item-start", itemInstanceId: "helm" });
    expect(active[0].status).toBe("active");
    const ok = applyStreamEvent(active, {
      type: "item",
      result: { itemInstanceId: "helm", ok: true },
    });
    expect(ok[0].status).toBe("ok");
    const fail = applyStreamEvent(active, {
      type: "item",
      result: { itemInstanceId: "helm", ok: false, message: "exotic conflict" },
    });
    expect(fail[0]).toMatchObject({ status: "fail", message: "exotic conflict" });
  });

  test("marks a plug active, then ok", () => {
    const plug = { itemInstanceId: "helm", socketIndex: 1, plugItemHash: 9 };
    const active = applyStreamEvent(items, { type: "plug-start", plug });
    expect(active[1].status).toBe("active");
    const ok = applyStreamEvent(active, { type: "plug", result: { ...plug, ok: true } });
    expect(ok[1].status).toBe("ok");
  });

  test("error fails anything still pending or active", () => {
    const mid = applyStreamEvent(items, { type: "item-start", itemInstanceId: "helm" });
    const done = applyStreamEvent(mid, { type: "item", result: { itemInstanceId: "helm", ok: true } });
    const failed = applyStreamEvent(done, { type: "error", error: "signed out" });
    expect(failed[0].status).toBe("ok");
    expect(failed[1]).toMatchObject({ status: "fail", message: "signed out" });
  });

  test("done leaves steps unchanged", () => {
    expect(applyStreamEvent(items, { type: "done", equip: [], plugs: [] })).toBe(items);
  });
});

describe("finishKind", () => {
  test("ok / partial / fail", () => {
    expect(finishKind([step("a", "ok"), step("b", "ok")])).toBe("ok");
    expect(finishKind([step("a", "ok"), step("b", "fail")])).toBe("partial");
    expect(finishKind([step("a", "fail"), step("b", "fail")])).toBe("fail");
  });
});

describe("readNdjsonLines", () => {
  test("yields complete lines as they arrive, including a final line without a newline", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"item-start"}\n{"type":"'));
        controller.enqueue(encoder.encode('done"}\n{"type":"tail"}'));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of readNdjsonLines(stream)) lines.push(line);
    expect(lines).toEqual(['{"type":"item-start"}', '{"type":"done"}', '{"type":"tail"}']);
  });
});

describe("parseApplyStreamEvent", () => {
  test("parses a known event and rejects junk", () => {
    expect(parseApplyStreamEvent('{"type":"item-start","itemInstanceId":"a"}')).toEqual({
      type: "item-start",
      itemInstanceId: "a",
    });
    expect(parseApplyStreamEvent("not json")).toBeNull();
    expect(parseApplyStreamEvent("{}")).toBeNull();
  });
});
