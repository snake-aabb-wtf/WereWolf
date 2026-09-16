import type { AgentContext, AgentProvider, AgentTurnResult, GenerateTurnOptions } from "./types.js";

export class FakeProvider implements AgentProvider {
  async generateTurn(context: AgentContext, options: GenerateTurnOptions = {}): Promise<AgentTurnResult> {
    const target = context.legalTargets[0] ?? null;
    const speech = fakeSpeech(context);
    if (options.onDelta) {
      for (const chunk of speech.match(/.{1,8}/gu) ?? [speech]) options.onDelta(chunk);
    }
    if (context.phase === "day_vote") {
      const result: AgentTurnResult = { speech };
      if (target) result.voteTargetSeatId = target;
      return result;
    }
    if (context.phase === "wolf_discussion") {
      return { speech, action: { type: "wolf.propose", targetSeatId: target, message: "先从公开票型里找出最不自然的人。" } };
    }
    if (context.phase === "seer_action") return { speech, action: { type: "seer.inspect", targetSeatId: target } };
    if (context.phase === "witch_action") return { speech, action: { type: "witch.resolve", save: false, poisonTargetSeatId: null } };
    if (context.phase === "hunter_action") return { speech, action: { type: "hunter.shoot", targetSeatId: target } };
    return { speech };
  }
}

function fakeSpeech(context: AgentContext): string {
  const prefix = context.kind === "wolf" ? "我先从票型看" : "我目前观察到";
  const target = context.legalTargets[0] ?? "场上";
  return `${prefix} ${target}，这只是基于当前公开信息的初步判断。`;
}
