import type { DeathCause, Phase, PlayerState, PublicState, Role } from "@werewolf/domain";

export const phaseNames: Record<Phase, string> = {
  lobby: "准备",
  wolf_discussion: "狼队密谈",
  guard_action: "守卫守护",
  seer_action: "预言家查验",
  witch_action: "女巫决策",
  day_speech: "依次发言",
  day_vote: "放逐投票",
  hunter_action: "猎人开枪",
  game_over: "游戏结束"
};

export const roleNames: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  guard: "守卫",
  villager: "村民"
};

export const deathCauseNames: Record<DeathCause, string> = {
  werewolf: "狼杀",
  witch: "女巫毒杀",
  vote: "放逐",
  hunter: "猎人开枪"
};

export function roleGlyph(role: Role): string {
  return { werewolf: "☾", seer: "◉", witch: "✣", hunter: "⌁", guard: "◇", villager: "○" }[role];
}

export function playerName(game: { players: ReadonlyArray<Pick<PlayerState, "seatId" | "name">> }, seatId: string): string {
  return game.players.find((player) => player.seatId === seatId)?.name ?? seatId;
}

export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp);
}
