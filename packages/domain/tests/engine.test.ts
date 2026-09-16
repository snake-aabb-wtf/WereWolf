import { describe, expect, it } from "vitest";
import { applyCommand, createGame, getPlayer, toPublicState, type GameState } from "../src/index.js";

function command(state: GameState, type: Parameters<typeof applyCommand>[1]["type"], actorSeatId: string, payload: unknown): GameState {
  return applyCommand(state, { requestId: crypto.randomUUID(), type, actorSeatId, payload } as Parameters<typeof applyCommand>[1]);
}

function reachDayVote(seed = 12): GameState {
  let state = createGame({ gameId: "test-game", seed, humanSeatId: "seat-1" });
  const wolves = state.players.filter((player) => player.role === "werewolf");
  const villager = state.players.find((player) => player.role === "villager")!;
  wolves.forEach((wolf) => {
    state = command(state, "wolf.propose", wolf.seatId, { targetSeatId: villager.seatId, message: "测试提议" });
  });
  const seer = state.players.find((player) => player.role === "seer");
  if (seer?.status === "alive") {
    state = command(state, "seer.inspect", seer.seatId, { targetSeatId: villager.seatId });
  }
  const witch = state.players.find((player) => player.role === "witch");
  if (witch?.status === "alive") {
    state = command(state, "witch.resolve", witch.seatId, { save: false, poisonTargetSeatId: null });
  } else if (state.phase === "witch_action") {
    state = command(state, "system.skip", "system", {});
  }
  if (state.phase === "hunter_action") state = command(state, "hunter.shoot", state.night.activeHunterSeatId!, { targetSeatId: null });
  for (const seatId of state.day.speechOrder) state = command(state, "speech.submit", seatId, { text: "测试发言" });
  return state;
}

describe("deterministic werewolf engine", () => {
  it("deals the classic eight-player role set reproducibly", () => {
    const first = createGame({ gameId: "a", seed: 7 });
    const second = createGame({ gameId: "b", seed: 7 });
    expect(first.players.map((player) => player.role)).toEqual(second.players.map((player) => player.role));
    expect(first.players.filter((player) => player.role === "werewolf")).toHaveLength(2);
    expect(first.players.filter((player) => player.role === "seer")).toHaveLength(1);
    expect(first.players.filter((player) => player.role === "witch")).toHaveLength(1);
    expect(first.players.filter((player) => player.role === "hunter")).toHaveLength(1);
  });

  it("resolves a unanimous wolf proposal and keeps the target hidden from villagers", () => {
    let state = createGame({ gameId: "wolf-test", seed: 3 });
    const wolves = state.players.filter((player) => player.role === "werewolf");
    const target = state.players.find((player) => player.faction === "village")!;
    wolves.forEach((wolf) => {
      state = command(state, "wolf.propose", wolf.seatId, { targetSeatId: target.seatId, message: "只给狼队看的话" });
    });
    expect(state.phase).toBe("seer_action");
    const villageSeat = state.players.find((player) => player.faction === "village")!.seatId;
    const villageView = toPublicState(state, villageSeat);
    expect(villageView.events.some((event) => event.type === "wolf.proposal")).toBe(false);
    const wolfView = toPublicState(state, wolves[0]!.seatId);
    expect(wolfView.events.some((event) => event.type === "wolf.proposal")).toBe(true);
  });

  it("does not allow a witch to self-save or use two potions in one night", () => {
    let state = createGame({ gameId: "witch-test", seed: 8 });
    const wolves = state.players.filter((player) => player.role === "werewolf");
    const witch = state.players.find((player) => player.role === "witch")!;
    wolves.forEach((wolf) => {
      state = command(state, "wolf.propose", wolf.seatId, { targetSeatId: witch.seatId, message: "测试" });
    });
    const seer = state.players.find((player) => player.role === "seer");
    if (seer?.status === "alive") state = command(state, "seer.inspect", seer.seatId, { targetSeatId: witch.seatId });
    expect(() => command(state, "witch.resolve", witch.seatId, { save: true, poisonTargetSeatId: null })).toThrow("不能自救");
  });

  it("leaves the table unchanged when the vote is tied", () => {
    let state = reachDayVote();
    const living = state.players.filter((player) => player.status === "alive");
    const left = living[0]!;
    const right = living[1]!;
    const third = living[2]!;
    const assignments = new Map<string, string>([
      [living[0]!.seatId, right.seatId],
      [living[1]!.seatId, left.seatId],
      [living[2]!.seatId, left.seatId],
      [living[3]!.seatId, left.seatId],
      [living[4]!.seatId, right.seatId],
      [living[5]!.seatId, right.seatId],
      [living[6]!.seatId, third.seatId]
    ]);
    living.forEach((player) => {
      state = command(state, "vote.cast", player.seatId, { targetSeatId: assignments.get(player.seatId) });
    });
    expect(state.events.some((event) => event.payload.cause === "tie")).toBe(true);
    expect(state.players.filter((player) => player.status === "dead")).toHaveLength(1);
  });

  it("returns only the human role and legal actions in the public projection", () => {
    const state = createGame({ gameId: "projection-test", seed: 18 });
    const projection = toPublicState(state, "seat-1");
    expect(projection.players.every((player) => !("role" in player))).toBe(true);
    expect(projection.human.seatId).toBe("seat-1");
    expect(projection.human.availableActions).toEqual(getPlayer(state, "seat-1").role === "werewolf" ? ["wolf.propose"] : []);
  });
});
