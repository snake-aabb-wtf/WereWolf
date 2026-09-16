import type { GameEvent, Phase, Role } from "@werewolf/domain";

export type AgentKind = "wolf" | "seer" | "witch" | "villager" | "hunter" | "guard";

export interface AgentContext {
  gameId: string;
  round: number;
  phase: Phase;
  seatId: string;
  name: string;
  role: Role;
  personality: string;
  visibleEvents: GameEvent[];
  legalTargets: string[];
  wolfMates: string[];
  kind: AgentKind;
  fallbackSeed: number;
}

export interface AgentAction {
  type: "wolf.propose" | "guard.protect" | "seer.inspect" | "witch.resolve" | "hunter.shoot";
  targetSeatId?: string | null;
  save?: boolean;
  poisonTargetSeatId?: string | null;
  message?: string;
}

export interface AgentTurnResult {
  speech: string;
  action?: AgentAction;
  voteTargetSeatId?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface GenerateTurnOptions {
  stream?: boolean;
  enableVoteTool?: boolean;
  onDelta?: (delta: string) => void;
}

export interface AgentProvider {
  generateTurn(context: AgentContext, options?: GenerateTurnOptions): Promise<AgentTurnResult>;
}
