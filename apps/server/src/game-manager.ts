import { randomUUID } from "node:crypto";
import {
  applyCommand,
  createGame,
  getHumanPlayer,
  getPendingActors,
  getPlayer,
  recordPresentationEvent,
  toPublicState,
  visibleEventsFor,
  type Command,
  type GameEvent,
  type GameState,
  type Phase,
  type Role
} from "@werewolf/domain";
import {
  FakeProvider,
  OpenAICompatibleProvider,
  type AgentContext,
  type AgentProvider,
  type AgentTurnResult,
  type GenerateTurnOptions
} from "@werewolf/llm";
import { GameRepository } from "./db.js";

type Listener = (event: GameEvent) => void;

interface Runtime {
  state: GameState;
  humanSeatId: string;
  listeners: Set<{ seatId: string; listener: Listener }>;
  driving: boolean;
  aiBusy: boolean;
}

export class GameManager {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly fallback = new FakeProvider();
  private readonly provider: AgentProvider;

  constructor(private readonly repository: GameRepository) {
    const apiKey = process.env.LLM_API_KEY?.trim();
    this.provider = apiKey
      ? new OpenAICompatibleProvider({
          apiKey,
          baseURL: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
          model: process.env.LLM_MODEL ?? "gpt-4o-mini"
        })
      : this.fallback;
  }

  create(seed?: number): { gameId: string; playerToken: string; humanSeatId: string; state: ReturnType<typeof toPublicState> } {
    const gameId = randomUUID();
    const humanSeatId = "seat-1";
    const state = seed === undefined
      ? createGame({ gameId, humanSeatId })
      : createGame({ gameId, seed, humanSeatId });
    this.repository.createGame(state);
    const playerToken = this.repository.createSession(gameId, humanSeatId);
    this.runtimes.set(gameId, {
      state,
      humanSeatId,
      listeners: new Set(),
      driving: false,
      aiBusy: false
    });
    void this.drive(gameId);
    return { gameId, playerToken, humanSeatId, state: toPublicState(state, humanSeatId) };
  }

  authenticate(gameId: string, token: string): string | undefined {
    const session = this.repository.getSession(token);
    return session?.gameId === gameId ? session.seatId : undefined;
  }

  getPublicState(gameId: string, seatId: string) {
    return toPublicState(this.runtime(gameId).state, seatId);
  }

  eventsAfter(gameId: string, seatId: string, afterSeq: number): GameEvent[] {
    return visibleEventsFor(this.runtime(gameId).state, seatId).filter((event) => event.seq > afterSeq);
  }

  subscribe(gameId: string, seatId: string, listener: Listener): () => void {
    const runtime = this.runtime(gameId);
    const subscription = { seatId, listener };
    runtime.listeners.add(subscription);
    return () => runtime.listeners.delete(subscription);
  }

  async command(
    gameId: string,
    actorSeatId: string,
    requestId: string,
    type: Exclude<Command["type"], "system.skip">,
    payload: unknown
  ): Promise<ReturnType<typeof toPublicState>> {
    const runtime = this.runtime(gameId);
    if (this.repository.hasProcessedCommand(gameId, requestId)) return toPublicState(runtime.state, actorSeatId);
    if (runtime.aiBusy) throw new Error("AI 正在处理回合，请等待当前发言完成");
    const command = buildCommand(requestId, actorSeatId, type, payload);
    this.apply(runtime, command);
    this.repository.markCommandProcessed(gameId, requestId);
    void this.drive(gameId);
    return toPublicState(runtime.state, actorSeatId);
  }

  private runtime(gameId: string): Runtime {
    const existing = this.runtimes.get(gameId);
    if (existing) return existing;
    const state = this.repository.loadGame(gameId);
    if (!state) throw new Error("游戏不存在");
    const runtime: Runtime = {
      state,
      humanSeatId: getHumanPlayer(state).seatId,
      listeners: new Set(),
      driving: false,
      aiBusy: false
    };
    this.runtimes.set(gameId, runtime);
    return runtime;
  }

  private apply(runtime: Runtime, command: Command): void {
    const previousSeq = runtime.state.events.length;
    runtime.state = applyCommand(runtime.state, command);
    this.repository.saveState(runtime.state);
    this.publish(runtime, previousSeq);
  }

  private publish(runtime: Runtime, previousSeq: number): void {
    for (const subscription of runtime.listeners) {
      const visible = visibleEventsFor(runtime.state, subscription.seatId);
      const events = visible.filter((event) => event.seq > previousSeq);
      events.forEach(subscription.listener);
    }
  }

  private async drive(gameId: string): Promise<void> {
    const runtime = this.runtime(gameId);
    if (runtime.driving) return;
    runtime.driving = true;
    try {
      while (runtime.state.phase !== "game_over") {
        const pending = getPendingActors(runtime.state);
        if (pending.length === 0) {
          if (shouldSkip(runtime.state.phase)) {
            this.apply(runtime, { requestId: randomUUID(), type: "system.skip", actorSeatId: "system", payload: {} });
            continue;
          }
          break;
        }

        if (runtime.state.phase === "wolf_discussion") {
          const aiSeats = pending.filter((seatId) => seatId !== runtime.humanSeatId);
          if (aiSeats.length === 0) break;
          const snapshot = structuredClone(runtime.state) as GameState;
          runtime.aiBusy = true;
          const results = await Promise.all(aiSeats.map((seatId) => this.generateFor(snapshot, seatId, false)));
          runtime.aiBusy = false;
          results.forEach(({ seatId, result }) => {
            const action = result.action;
            const targetSeatId = action?.targetSeatId;
            this.apply(runtime, {
              requestId: randomUUID(),
              type: "wolf.propose",
              actorSeatId: seatId,
              payload: {
                targetSeatId: this.isLegalTarget(runtime.state, seatId, targetSeatId) ? targetSeatId : this.fallbackTarget(runtime.state, seatId),
                message: action?.message ?? result.speech
              }
            });
          });
          continue;
        }

        const actorSeatId = pending[0];
        if (!actorSeatId || actorSeatId === runtime.humanSeatId) break;
        runtime.aiBusy = true;
        const { result } = await this.generateFor(runtime.state, actorSeatId, runtime.state.phase === "day_vote");
        runtime.aiBusy = false;
        this.applyAiResult(runtime, actorSeatId, result);
      }
    } catch (error) {
      runtime.aiBusy = false;
      const message = error instanceof Error ? error.message : "AI 调度失败";
      recordPresentationEvent(runtime.state, "agent.error", "public", { message });
      this.repository.saveState(runtime.state);
      this.publish(runtime, runtime.state.events.length - 1);
    } finally {
      runtime.aiBusy = false;
      runtime.driving = false;
    }
  }

  private async generateFor(state: GameState, seatId: string, enableVoteTool: boolean): Promise<{ seatId: string; result: AgentTurnResult }> {
    const context = buildContext(state, seatId);
    const streamed = state.phase === "day_speech";
    const emitDelta = (delta: string) => {
      const runtime = this.runtime(state.gameId);
      const previousSeq = runtime.state.events.length;
      recordPresentationEvent(runtime.state, "speech.delta", "public", { seatId, delta });
      this.repository.saveState(runtime.state);
      this.publish(runtime, previousSeq);
    };
    try {
      const providerOptions: GenerateTurnOptions = {
        enableVoteTool,
        stream: streamed
      };
      if (streamed) providerOptions.onDelta = emitDelta;
      const result = await this.provider.generateTurn(context, providerOptions);
      this.repository.recordAgentTurn({ gameId: state.gameId, seatId, phase: state.phase, status: "completed", usage: result.usage });
      return { seatId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM 请求失败";
      const runtime = this.runtime(state.gameId);
      const previousSeq = runtime.state.events.length;
      recordPresentationEvent(runtime.state, "agent.error", "public", { seatId, message });
      this.repository.recordAgentTurn({ gameId: state.gameId, seatId, phase: state.phase, status: "fallback", error: message });
      this.repository.saveState(runtime.state);
      this.publish(runtime, previousSeq);
      const fallbackOptions: GenerateTurnOptions = {
        stream: streamed,
        enableVoteTool
      };
      if (streamed) fallbackOptions.onDelta = emitDelta;
      const fallbackResult = await this.fallback.generateTurn(buildContext(runtime.state, seatId), fallbackOptions);
      return { seatId, result: fallbackResult };
    }
  }

  private applyAiResult(runtime: Runtime, actorSeatId: string, result: AgentTurnResult): void {
    const phase = runtime.state.phase;
    if (phase === "day_speech") {
      this.apply(runtime, {
        requestId: randomUUID(),
        type: "speech.submit",
        actorSeatId,
        payload: { text: result.speech }
      });
      return;
    }
    if (phase === "day_vote") {
      this.apply(runtime, {
        requestId: randomUUID(),
        type: "vote.cast",
        actorSeatId,
        payload: { targetSeatId: this.isLegalTarget(runtime.state, actorSeatId, result.voteTargetSeatId) ? result.voteTargetSeatId : this.fallbackTarget(runtime.state, actorSeatId) }
      });
      return;
    }
    const action = result.action;
    if (phase === "seer_action") {
      this.apply(runtime, {
        requestId: randomUUID(),
        type: "seer.inspect",
        actorSeatId,
        payload: { targetSeatId: this.isLegalTarget(runtime.state, actorSeatId, action?.targetSeatId) ? action.targetSeatId : this.fallbackTarget(runtime.state, actorSeatId) }
      });
      return;
    }
    if (phase === "witch_action") {
      this.apply(runtime, {
        requestId: randomUUID(),
        type: "witch.resolve",
        actorSeatId,
        payload: {
          save: action?.save === true,
          poisonTargetSeatId: action?.poisonTargetSeatId && this.isLegalTarget(runtime.state, actorSeatId, action.poisonTargetSeatId)
            ? action.poisonTargetSeatId
            : null
        }
      });
      return;
    }
    if (phase === "hunter_action") {
      this.apply(runtime, {
        requestId: randomUUID(),
        type: "hunter.shoot",
        actorSeatId,
        payload: { targetSeatId: this.isLegalTarget(runtime.state, actorSeatId, action?.targetSeatId) ? action.targetSeatId : null }
      });
    }
  }

  private isLegalTarget(state: GameState, actorSeatId: string, targetSeatId: unknown): targetSeatId is string {
    if (typeof targetSeatId !== "string") return false;
    const actor = getPlayer(state, actorSeatId);
    const target = state.players.find((player) => player.seatId === targetSeatId);
    if (!target || target.status !== "alive" || target.seatId === actorSeatId) return false;
    return actor.role !== "werewolf" || target.faction !== "werewolf";
  }

  private fallbackTarget(state: GameState, actorSeatId: string): string {
    const actor = getPlayer(state, actorSeatId);
    const targets = state.players.filter((player) => player.status === "alive" && player.seatId !== actorSeatId && (actor.role !== "werewolf" || player.faction !== "werewolf"));
    return targets[(Math.abs(state.seed + state.round + actorSeatId.length) % targets.length)]?.seatId ?? actorSeatId;
  }
}

function buildContext(state: GameState, seatId: string): AgentContext {
  const player = getPlayer(state, seatId);
  const legalTargets = state.phase === "witch_action"
    ? state.players.filter((candidate) => candidate.status === "alive" && candidate.seatId !== seatId).map((candidate) => candidate.seatId)
    : state.phase === "day_speech"
      ? []
      : state.players
          .filter((candidate) => candidate.status === "alive" && candidate.seatId !== seatId && (player.role !== "werewolf" || candidate.faction !== "werewolf"))
          .map((candidate) => candidate.seatId);
  const kind = agentKind(player.role);
  return {
    gameId: state.gameId,
    round: state.round,
    phase: state.phase,
    seatId,
    name: player.name,
    role: player.role,
    personality: player.personality,
    visibleEvents: visibleEventsFor(state, seatId),
    legalTargets,
    wolfMates: player.role === "werewolf"
      ? state.players.filter((candidate) => candidate.role === "werewolf" && candidate.seatId !== seatId).map((candidate) => candidate.seatId)
      : [],
    kind,
    fallbackSeed: state.seed + state.round + seatId.length
  };
}

function agentKind(role: Role): AgentContext["kind"] {
  return role === "werewolf" ? "wolf" : role;
}

function shouldSkip(phase: Phase): boolean {
  return phase === "seer_action" || phase === "witch_action" || phase === "hunter_action" || phase === "day_speech";
}

function buildCommand(
  requestId: string,
  actorSeatId: string,
  type: Exclude<Command["type"], "system.skip">,
  payload: unknown
): Command {
  switch (type) {
    case "wolf.propose": {
      const value = payload as { targetSeatId?: unknown; message?: unknown };
      return { requestId, type, actorSeatId, payload: { targetSeatId: String(value.targetSeatId ?? ""), message: String(value.message ?? "") } };
    }
    case "seer.inspect":
      return { requestId, type, actorSeatId, payload: { targetSeatId: String((payload as { targetSeatId?: unknown }).targetSeatId ?? "") } };
    case "witch.resolve": {
      const value = payload as { save?: unknown; poisonTargetSeatId?: unknown };
      return { requestId, type, actorSeatId, payload: { save: value.save === true, poisonTargetSeatId: typeof value.poisonTargetSeatId === "string" ? value.poisonTargetSeatId : null } };
    }
    case "speech.submit":
      return { requestId, type, actorSeatId, payload: { text: String((payload as { text?: unknown }).text ?? "") } };
    case "vote.cast":
      return { requestId, type, actorSeatId, payload: { targetSeatId: String((payload as { targetSeatId?: unknown }).targetSeatId ?? "") } };
    case "hunter.shoot": {
      const value = payload as { targetSeatId?: unknown };
      return { requestId, type, actorSeatId, payload: { targetSeatId: typeof value.targetSeatId === "string" ? value.targetSeatId : null } };
    }
  }
}
