export type Role = "werewolf" | "seer" | "witch" | "hunter" | "guard" | "villager";
export type Faction = "village" | "werewolf";
export type PlayerKind = "human" | "ai";
export type PlayerStatus = "alive" | "dead";
export type DeathCause = "werewolf" | "witch" | "vote" | "hunter";
export type SaveStatus = "in_progress" | "completed";

export type Phase =
  | "lobby"
  | "wolf_discussion"
  | "guard_action"
  | "seer_action"
  | "witch_action"
  | "day_speech"
  | "day_vote"
  | "hunter_action"
  | "game_over";

export type Visibility =
  | "public"
  | { kind: "seat"; seatId: string }
  | { kind: "role"; role: Role };

export interface PlayerState {
  seatId: string;
  name: string;
  kind: PlayerKind;
  role: Role;
  faction: Faction;
  personality: string;
  status: PlayerStatus;
  deathCause?: DeathCause;
  deathRound?: number;
}

export interface WolfProposal {
  targetSeatId: string;
  message: string;
}

export interface PendingDeath {
  seatId: string;
  cause: DeathCause;
}

export interface NightState {
  wolfProposals: Record<string, WolfProposal>;
  wolfKillTarget?: string;
  guardTarget?: string;
  pendingDeaths: PendingDeath[];
  activeHunterSeatId?: string;
  seerTarget?: string;
  seerResult?: Role;
  guardResolved: boolean;
  witchResolved: boolean;
  witchSaveUsedThisNight: boolean;
  witchPoisonTarget?: string;
}

export interface DayState {
  speechOrder: string[];
  speechIndex: number;
  votes: Record<string, string>;
}

export interface GameEvent {
  seq: number;
  type:
    | "game.started"
    | "phase.changed"
    | "wolf.proposal"
    | "guard.result"
    | "seer.result"
    | "witch.result"
    | "speech.delta"
    | "speech.completed"
    | "vote.cast"
    | "player.eliminated"
    | "hunter.prompt"
    | "game.over"
    | "agent.error";
  visibility: Visibility;
  round: number;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface GameState {
  gameId: string;
  seed: number;
  round: number;
  phase: Phase;
  players: PlayerState[];
  events: GameEvent[];
  night: NightState;
  day: DayState;
  usedPotions: {
    witchAntidote: boolean;
    witchPoison: boolean;
  };
  winner?: Faction;
}

export type Command =
  | {
      requestId: string;
      type: "wolf.propose";
      actorSeatId: string;
      payload: WolfProposal;
    }
  | {
      requestId: string;
      type: "guard.protect";
      actorSeatId: string;
      payload: { targetSeatId: string };
    }
  | {
      requestId: string;
      type: "seer.inspect";
      actorSeatId: string;
      payload: { targetSeatId: string };
    }
  | {
      requestId: string;
      type: "witch.resolve";
      actorSeatId: string;
      payload: { save: boolean; poisonTargetSeatId?: string | null };
    }
  | {
      requestId: string;
      type: "speech.submit";
      actorSeatId: string;
      payload: { text: string };
    }
  | {
      requestId: string;
      type: "vote.cast";
      actorSeatId: string;
      payload: { targetSeatId: string };
    }
  | {
      requestId: string;
      type: "hunter.shoot";
      actorSeatId: string;
      payload: { targetSeatId: string | null };
    }
  | {
      requestId: string;
      type: "system.skip";
      actorSeatId: "system";
      payload: Record<string, never>;
    };

export interface PublicPlayer {
  seatId: string;
  name: string;
  kind: PlayerKind;
  status: PlayerStatus;
  deathCause?: DeathCause;
  deathRound?: number;
  isHuman: boolean;
}

export interface PublicState {
  gameId: string;
  round: number;
  phase: Phase;
  players: PublicPlayer[];
  events: GameEvent[];
  human: {
    seatId: string;
    role: Role;
    faction: Faction;
    personality: string;
    wolfMates?: string[];
    canAct: boolean;
    availableActions: string[];
  };
  winner?: Faction;
}

export interface SaveSummary {
  gameId: string;
  name: string;
  status: SaveStatus;
  round: number;
  phase: Phase;
  playerCount: number;
  aliveCount: number;
  winner?: Faction;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface ReplayState {
  gameId: string;
  name: string;
  round: number;
  winner: Faction;
  players: PlayerState[];
  events: GameEvent[];
}

export interface CreateGameOptions {
  gameId: string;
  seed?: number;
  humanSeatId?: string;
}
