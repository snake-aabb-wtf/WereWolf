import { describe, expect, it } from "vitest";
import { FakeProvider } from "../src/index.js";
import type { AgentContext } from "../src/index.js";

const context: AgentContext = {
  gameId: "test",
  round: 1,
  phase: "day_vote",
  seatId: "seat-1",
  name: "测试玩家",
  role: "villager",
  personality: "冷静",
  visibleEvents: [],
  legalTargets: ["seat-2"],
  wolfMates: [],
  kind: "villager",
  fallbackSeed: 1
};

describe("FakeProvider", () => {
  it("produces a legal deterministic vote and streams speech chunks", async () => {
    const chunks: string[] = [];
    const result = await new FakeProvider().generateTurn(context, { onDelta: (chunk) => chunks.push(chunk) });
    expect(result.voteTargetSeatId).toBe("seat-2");
    expect(chunks.join("")).toBe(result.speech);
  });

  it("returns a guard action for the guard phase", async () => {
    const result = await new FakeProvider().generateTurn({ ...context, phase: "guard_action", role: "guard", kind: "guard", legalTargets: ["seat-1", "seat-2"] });
    expect(result.action).toEqual({ type: "guard.protect", targetSeatId: "seat-1" });
  });
});
