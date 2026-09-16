import { createSeed, shuffle } from "./rng.js";
import type {
  Command,
  CreateGameOptions,
  DeathCause,
  Faction,
  GameEvent,
  GameState,
  Phase,
  PlayerState,
  PublicState,
  Role,
  Visibility,
  WolfProposal
} from "./types.js";

const PLAYER_NAMES = ["你", "阿岚", "白榆", "赤羽", "冬青", "弥生", "南星", "青禾"];
const PERSONALITIES = [
  "冷静的统计派，喜欢用投票和存活率说话。",
  "直觉敏锐但表达克制，习惯先听完所有人。",
  "热情的追问者，会把矛盾放大来确认立场。",
  "谨慎的调停者，倾向寻找最小风险的方案。",
  "强势的领袖型玩家，喜欢推动明确的票型。",
  "善于讲故事的观察者，关注每个人的语气变化。",
  "不安牌的逆向思考者，常常质疑最明显的答案。"
];
const ROLES: Role[] = [
  "werewolf",
  "werewolf",
  "seer",
  "witch",
  "hunter",
  "villager",
  "villager",
  "villager"
];

export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export function factionForRole(role: Role): Faction {
  return role === "werewolf" ? "werewolf" : "village";
}

export function createGame(options: CreateGameOptions): GameState {
  const seed = options.seed ?? createSeed();
  const humanSeatId = options.humanSeatId ?? "seat-1";
  const roles = shuffle(ROLES, seed);
  const players: PlayerState[] = roles.map((role, index) => {
    const seatId = `seat-${index + 1}`;
    const player: PlayerState = {
      seatId,
      name: PLAYER_NAMES[index] ?? `玩家 ${index + 1}`,
      kind: seatId === humanSeatId ? "human" : "ai",
      role,
      faction: factionForRole(role),
      personality: seatId === humanSeatId ? "你自己" : PERSONALITIES[index - 1] ?? "安静的观察者。",
      status: "alive"
    };
    return player;
  });

  const state: GameState = {
    gameId: options.gameId,
    seed,
    round: 1,
    phase: "wolf_discussion",
    players,
    events: [],
    night: emptyNight(),
    day: emptyDay(),
    usedPotions: { witchAntidote: false, witchPoison: false }
  };

  addEvent(state, "game.started", "public", {
    gameId: state.gameId,
    playerCount: state.players.length
  });
  addEvent(state, "phase.changed", "public", {
    phase: state.phase,
    label: phaseLabel(state.phase)
  });
  return state;
}

export function applyCommand(state: GameState, command: Command): GameState {
  const next = structuredClone(state) as GameState;
  switch (command.type) {
    case "wolf.propose":
      applyWolfProposal(next, command.actorSeatId, command.payload);
      break;
    case "seer.inspect":
      applySeerInspect(next, command.actorSeatId, command.payload.targetSeatId);
      break;
    case "witch.resolve":
      applyWitchResolve(next, command.actorSeatId, command.payload.save, command.payload.poisonTargetSeatId);
      break;
    case "speech.submit":
      applySpeech(next, command.actorSeatId, command.payload.text);
      break;
    case "vote.cast":
      applyVote(next, command.actorSeatId, command.payload.targetSeatId);
      break;
    case "hunter.shoot":
      applyHunterShot(next, command.actorSeatId, command.payload.targetSeatId);
      break;
    case "system.skip":
      applySystemSkip(next);
      break;
  }
  return next;
}

export function getPlayer(state: GameState, seatId: string): PlayerState {
  const player = state.players.find((candidate) => candidate.seatId === seatId);
  if (!player) throw new EngineError("PLAYER_NOT_FOUND", `找不到玩家 ${seatId}`);
  return player;
}

export function getHumanPlayer(state: GameState): PlayerState {
  const player = state.players.find((candidate) => candidate.kind === "human");
  if (!player) throw new EngineError("HUMAN_NOT_FOUND", "游戏缺少真人玩家");
  return player;
}

export function getPendingActors(state: GameState): string[] {
  if (state.phase === "wolf_discussion") {
    return state.players
      .filter((player) => player.role === "werewolf" && player.status === "alive")
      .map((player) => player.seatId)
      .filter((seatId) => !state.night.wolfProposals[seatId]);
  }
  if (state.phase === "seer_action") {
    const seer = state.players.find((player) => player.role === "seer" && player.status === "alive");
    return seer && !state.night.seerTarget ? [seer.seatId] : [];
  }
  if (state.phase === "witch_action") {
    const witch = state.players.find((player) => player.role === "witch" && player.status === "alive");
    return witch && !state.night.witchResolved
      ? [witch.seatId]
      : [];
  }
  if (state.phase === "hunter_action") {
    return state.night.activeHunterSeatId ? [state.night.activeHunterSeatId] : [];
  }
  if (state.phase === "day_speech") {
    return state.day.speechIndex < state.day.speechOrder.length
      ? [state.day.speechOrder[state.day.speechIndex] ?? ""]
      : [];
  }
  if (state.phase === "day_vote") {
    return state.players
      .filter((player) => player.status === "alive")
      .map((player) => player.seatId)
      .filter((seatId) => !state.day.votes[seatId]);
  }
  return [];
}

export function toPublicState(state: GameState, humanSeatId: string): PublicState {
  const human = getPlayer(state, humanSeatId);
  const humanCanAct = getPendingActors(state).includes(humanSeatId);
  const publicEvents = state.events.filter((event) => canSee(event.visibility, humanSeatId, human.role));
  const players: PublicState["players"] = state.players.map((player) => {
    const publicPlayer: PublicState["players"][number] = {
      seatId: player.seatId,
      name: player.name,
      kind: player.kind,
      status: player.status,
      isHuman: player.seatId === humanSeatId
    };
    if (player.deathCause) publicPlayer.deathCause = player.deathCause;
    if (player.deathRound) publicPlayer.deathRound = player.deathRound;
    return publicPlayer;
  });
  const result: PublicState = {
    gameId: state.gameId,
    round: state.round,
    phase: state.phase,
    players,
    events: publicEvents,
    human: {
      seatId: human.seatId,
      role: human.role,
      faction: human.faction,
      personality: human.personality,
      canAct: humanCanAct,
      availableActions: availableActions(state, humanSeatId)
    }
  };
  if (human.role === "werewolf") {
    result.human.wolfMates = state.players
      .filter((player) => player.role === "werewolf" && player.seatId !== humanSeatId)
      .map((player) => player.seatId);
  }
  if (state.winner) result.winner = state.winner;
  return result;
}

export function visibleEventsFor(state: GameState, viewerSeatId: string): GameEvent[] {
  const viewer = getPlayer(state, viewerSeatId);
  return state.events.filter((event) => canSee(event.visibility, viewerSeatId, viewer.role));
}

export function recordPresentationEvent(
  state: GameState,
  type: Extract<GameEvent["type"], "speech.delta" | "speech.completed" | "agent.error">,
  visibility: Visibility,
  payload: Record<string, unknown>
): void {
  addEvent(state, type, visibility, payload);
}

export function phaseLabel(phase: Phase): string {
  return {
    lobby: "准备",
    wolf_discussion: "夜间 · 狼队密谈",
    seer_action: "夜间 · 预言家查验",
    witch_action: "夜间 · 女巫决策",
    day_speech: "白天 · 依次发言",
    day_vote: "白天 · 放逐投票",
    hunter_action: "猎人开枪",
    game_over: "游戏结束"
  }[phase];
}

function emptyNight(): GameState["night"] {
  return {
    wolfProposals: {},
    pendingDeaths: [],
    witchResolved: false,
    witchSaveUsedThisNight: false
  };
}

function emptyDay(): GameState["day"] {
  return { speechOrder: [], speechIndex: 0, votes: {} };
}

function addEvent(
  state: GameState,
  type: GameEvent["type"],
  visibility: Visibility,
  payload: Record<string, unknown>
): void {
  state.events.push({
    seq: state.events.length + 1,
    type,
    visibility,
    round: state.round,
    createdAt: Date.now(),
    payload
  });
}

function canSee(visibility: Visibility, humanSeatId: string, humanRole: Role): boolean {
  if (visibility === "public") return true;
  if (visibility.kind === "seat") return visibility.seatId === humanSeatId;
  return visibility.kind === "role" && visibility.role === humanRole;
}

function requirePhase(state: GameState, phase: Phase): void {
  if (state.phase !== phase) throw new EngineError("WRONG_PHASE", `当前不是${phaseLabel(phase)}阶段`);
}

function requireAlive(state: GameState, seatId: string): PlayerState {
  const player = getPlayer(state, seatId);
  if (player.status !== "alive") throw new EngineError("PLAYER_DEAD", "已出局的玩家不能行动");
  return player;
}

function requireTarget(state: GameState, targetSeatId: string, options?: { exclude?: string }): PlayerState {
  const target = requireAlive(state, targetSeatId);
  if (options?.exclude === target.seatId) throw new EngineError("INVALID_TARGET", "不能选择自己");
  return target;
}

function requireRole(state: GameState, seatId: string, role: Role): PlayerState {
  const player = requireAlive(state, seatId);
  if (player.role !== role) throw new EngineError("INVALID_ROLE", "当前玩家没有这个技能");
  return player;
}

function applyWolfProposal(state: GameState, actorSeatId: string, proposal: WolfProposal): void {
  requirePhase(state, "wolf_discussion");
  const wolf = requireRole(state, actorSeatId, "werewolf");
  const target = requireTarget(state, proposal.targetSeatId, { exclude: actorSeatId });
  if (target.faction === "werewolf") throw new EngineError("INVALID_TARGET", "狼人不能选择狼队队友");
  if (state.night.wolfProposals[actorSeatId]) throw new EngineError("ACTION_ALREADY_USED", "本夜已经提交过狼刀提议");
  state.night.wolfProposals[actorSeatId] = {
    targetSeatId: proposal.targetSeatId,
    message: proposal.message.trim().slice(0, 300)
  };
  addEvent(state, "wolf.proposal", { kind: "role", role: "werewolf" }, {
    seatId: wolf.seatId,
    targetSeatId: proposal.targetSeatId,
    message: proposal.message.trim().slice(0, 300)
  });
  const wolves = state.players.filter((player) => player.role === "werewolf" && player.status === "alive");
  if (wolves.every((player) => state.night.wolfProposals[player.seatId])) {
    const ordered = wolves.toSorted((left, right) => left.seatId.localeCompare(right.seatId));
    const first = state.night.wolfProposals[ordered[0]?.seatId ?? ""];
    const second = state.night.wolfProposals[ordered[1]?.seatId ?? ""];
    if (first && second) {
      state.night.wolfKillTarget = first.targetSeatId;
      addEvent(state, "wolf.proposal", { kind: "role", role: "werewolf" }, {
        resolvedTargetSeatId: state.night.wolfKillTarget,
        method: first.targetSeatId === second.targetSeatId ? "一致" : "座位号优先"
      });
    }
    transitionTo(state, "seer_action");
  }
}

function applySeerInspect(state: GameState, actorSeatId: string, targetSeatId: string): void {
  requirePhase(state, "seer_action");
  const seer = requireRole(state, actorSeatId, "seer");
  requireTarget(state, targetSeatId, { exclude: actorSeatId });
  if (state.night.seerTarget) throw new EngineError("ACTION_ALREADY_USED", "本夜已经查验过");
  state.night.seerTarget = targetSeatId;
  const target = getPlayer(state, targetSeatId);
  state.night.seerResult = target.role;
  addEvent(state, "seer.result", { kind: "seat", seatId: seer.seatId }, {
    targetSeatId,
    faction: target.faction
  });
  transitionTo(state, "witch_action");
}

function applyWitchResolve(
  state: GameState,
  actorSeatId: string,
  save: boolean,
  poisonTargetSeatId?: string | null
): void {
  requirePhase(state, "witch_action");
  const witch = requireRole(state, actorSeatId, "witch");
  if (state.night.witchResolved) throw new EngineError("ACTION_ALREADY_USED", "本夜已经做出女巫决策");
  if (save && poisonTargetSeatId) throw new EngineError("INVALID_ACTION", "每晚最多使用一种药剂");
  if (save && state.usedPotions.witchAntidote) throw new EngineError("POTION_USED", "解药已经用过");
  if (poisonTargetSeatId && state.usedPotions.witchPoison) throw new EngineError("POTION_USED", "毒药已经用过");
  if (save && state.night.wolfKillTarget === witch.seatId) throw new EngineError("INVALID_TARGET", "女巫不能自救");
  if (poisonTargetSeatId) requireTarget(state, poisonTargetSeatId, { exclude: witch.seatId });
  if (save) {
    state.usedPotions.witchAntidote = true;
    state.night.witchSaveUsedThisNight = true;
  }
  if (poisonTargetSeatId) {
    state.usedPotions.witchPoison = true;
    state.night.witchPoisonTarget = poisonTargetSeatId;
  }
  state.night.witchResolved = true;
  addEvent(state, "witch.result", { kind: "seat", seatId: witch.seatId }, {
    save,
    poisonTargetSeatId: poisonTargetSeatId ?? null
  });
  resolveNight(state);
}

function applySystemSkip(state: GameState): void {
  if (state.phase === "seer_action") {
    transitionTo(state, "witch_action");
    return;
  }
  if (state.phase === "witch_action") {
    resolveNight(state);
    return;
  }
  if (state.phase === "hunter_action") {
    startDay(state);
    return;
  }
  if (state.phase === "day_speech" && getPendingActors(state).length === 0) {
    transitionTo(state, "day_vote");
    return;
  }
  throw new EngineError("NOTHING_TO_SKIP", "当前阶段不需要跳过");
}

function resolveNight(state: GameState): void {
  state.night.pendingDeaths = [];
  if (state.night.wolfKillTarget && !state.night.witchSaveUsedThisNight) {
    state.night.pendingDeaths.push({ seatId: state.night.wolfKillTarget, cause: "werewolf" });
  }
  if (state.night.witchPoisonTarget) {
    state.night.pendingDeaths.push({ seatId: state.night.witchPoisonTarget, cause: "witch" });
  }
  const hunterDeath = state.night.pendingDeaths.find((death) => {
    const player = getPlayer(state, death.seatId);
    return player.role === "hunter" && death.cause !== "witch";
  });
  if (hunterDeath) {
    state.night.activeHunterSeatId = hunterDeath.seatId;
    applyDeaths(state, state.night.pendingDeaths);
    addEvent(state, "hunter.prompt", "public", { seatId: hunterDeath.seatId, cause: hunterDeath.cause });
    transitionTo(state, "hunter_action");
    return;
  }
  applyDeaths(state, state.night.pendingDeaths);
  if (checkWinner(state)) return;
  startDay(state);
}

function applySpeech(state: GameState, actorSeatId: string, text: string): void {
  requirePhase(state, "day_speech");
  const actor = requireAlive(state, actorSeatId);
  const expectedSeatId = state.day.speechOrder[state.day.speechIndex];
  if (expectedSeatId !== actorSeatId) throw new EngineError("NOT_YOUR_TURN", "还没轮到这名玩家发言");
  const cleanText = text.trim().slice(0, 800);
  if (!cleanText) throw new EngineError("EMPTY_SPEECH", "发言不能为空");
  addEvent(state, "speech.completed", "public", { seatId: actor.seatId, text: cleanText });
  state.day.speechIndex += 1;
  if (state.day.speechIndex >= state.day.speechOrder.length) transitionTo(state, "day_vote");
}

function applyVote(state: GameState, actorSeatId: string, targetSeatId: string): void {
  requirePhase(state, "day_vote");
  const actor = requireAlive(state, actorSeatId);
  const target = requireTarget(state, targetSeatId, { exclude: actorSeatId });
  if (state.day.votes[actorSeatId]) throw new EngineError("ACTION_ALREADY_USED", "已经投过票");
  state.day.votes[actorSeatId] = target.seatId;
  addEvent(state, "vote.cast", "public", { from: actor.seatId, target: target.seatId });
  const living = state.players.filter((player) => player.status === "alive");
  if (living.every((player) => state.day.votes[player.seatId])) resolveVote(state);
}

function applyHunterShot(state: GameState, actorSeatId: string, targetSeatId: string | null): void {
  requirePhase(state, "hunter_action");
  const hunter = getPlayer(state, actorSeatId);
  if (hunter.role !== "hunter") throw new EngineError("INVALID_ROLE", "当前玩家不是猎人");
  if (state.night.activeHunterSeatId !== hunter.seatId) throw new EngineError("INVALID_HUNTER", "猎人当前没有开枪资格");
  if (targetSeatId) {
    requireTarget(state, targetSeatId, { exclude: hunter.seatId });
    applyDeaths(state, [{ seatId: targetSeatId, cause: "hunter" }]);
  }
  delete state.night.activeHunterSeatId;
  if (checkWinner(state)) return;
  startDay(state);
}

function resolveVote(state: GameState): void {
  const counts = new Map<string, number>();
  Object.values(state.day.votes).forEach((targetSeatId) => {
    counts.set(targetSeatId, (counts.get(targetSeatId) ?? 0) + 1);
  });
  const highest = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, count]) => count === highest);
  if (leaders.length === 1) {
    const targetSeatId = leaders[0]?.[0];
    if (targetSeatId) {
      applyDeaths(state, [{ seatId: targetSeatId, cause: "vote" }]);
      const target = getPlayer(state, targetSeatId);
      if (target.role === "hunter") {
        state.night.activeHunterSeatId = targetSeatId;
        addEvent(state, "hunter.prompt", "public", { seatId: targetSeatId, cause: "vote" });
        transitionTo(state, "hunter_action");
        return;
      }
      if (checkWinner(state)) return;
    }
  } else {
    addEvent(state, "player.eliminated", "public", { seatId: null, cause: "tie", message: "平票，无人出局" });
  }
  beginNextNight(state);
}

function applyDeaths(state: GameState, deaths: { seatId: string; cause: DeathCause }[]): void {
  const seen = new Set<string>();
  deaths.forEach(({ seatId, cause }) => {
    if (seen.has(seatId)) return;
    const player = getPlayer(state, seatId);
    if (player.status === "dead") return;
    seen.add(seatId);
    player.status = "dead";
    player.deathCause = cause;
    player.deathRound = state.round;
    addEvent(state, "player.eliminated", "public", {
      seatId: player.seatId,
      name: player.name,
      cause
    });
  });
}

function checkWinner(state: GameState): boolean {
  const wolves = state.players.filter((player) => player.status === "alive" && player.faction === "werewolf").length;
  const villagers = state.players.filter((player) => player.status === "alive" && player.faction === "village").length;
  if (wolves === 0) {
    state.winner = "village";
    transitionTo(state, "game_over");
    addEvent(state, "game.over", "public", { winner: "village" });
    return true;
  }
  if (wolves >= villagers) {
    state.winner = "werewolf";
    transitionTo(state, "game_over");
    addEvent(state, "game.over", "public", { winner: "werewolf" });
    return true;
  }
  return false;
}

function startDay(state: GameState): void {
  state.day = {
    speechOrder: state.players.filter((player) => player.status === "alive").map((player) => player.seatId),
    speechIndex: 0,
    votes: {}
  };
  transitionTo(state, "day_speech");
}

function beginNextNight(state: GameState): void {
  state.round += 1;
  state.night = emptyNight();
  transitionTo(state, "wolf_discussion");
}

function transitionTo(state: GameState, phase: Phase): void {
  state.phase = phase;
  addEvent(state, "phase.changed", "public", { phase, label: phaseLabel(phase) });
}

function availableActions(state: GameState, humanSeatId: string): string[] {
  if (!getPendingActors(state).includes(humanSeatId)) return [];
  switch (state.phase) {
    case "wolf_discussion":
      return ["wolf.propose"];
    case "seer_action":
      return ["seer.inspect"];
    case "witch_action":
      return ["witch.resolve"];
    case "day_speech":
      return ["speech.submit"];
    case "day_vote":
      return ["vote.cast"];
    case "hunter_action":
      return ["hunter.shoot"];
    default:
      return [];
  }
}
