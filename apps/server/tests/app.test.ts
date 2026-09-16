import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createGame, type GameEvent } from "@werewolf/domain";
import { buildApp } from "../src/app.js";
import { GameRepository } from "../src/db.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("werewolf HTTP API", () => {
  it("creates a session and never exposes the server seed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-test-"));
    const repository = new GameRepository(join(directory, "test.db"));
    const app = buildApp(repository);
    cleanups.push(() => {
      void app.close();
      repository.db.close();
      rmSync(directory, { recursive: true, force: true });
    });

    const librarySession = await app.inject({ method: "POST", url: "/api/library-sessions" });
    expect(librarySession.statusCode).toBe(201);
    const libraryToken = (librarySession.json() as { libraryToken: string }).libraryToken;

    const created = await app.inject({ method: "POST", url: "/api/games", headers: { "x-library-token": libraryToken }, payload: { seed: 123 } });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { gameId: string; playerToken: string; state: Record<string, unknown>; save: { name: string; status: string } };
    expect(body.playerToken).toBeTruthy();
    expect((body.state.players as unknown[]).length).toBe(12);
    expect(body.save.status).toBe("in_progress");
    expect(body.save.name).toContain("暗桌 #1");
    expect(body.state).not.toHaveProperty("seed");
    expect(JSON.stringify(body.state.events)).not.toContain('"seed"');

    const state = await app.inject({
      method: "GET",
      url: `/api/games/${body.gameId}/state`,
      headers: { "x-player-token": body.playerToken }
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().human).toHaveProperty("role");

    const unauthorized = await app.inject({ method: "GET", url: `/api/games/${body.gameId}/state` });
    expect(unauthorized.statusCode).toBe(401);
  });

  it("scopes saves to the browser session and supports the recycle bin lifecycle", async () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-saves-test-"));
    const repository = new GameRepository(join(directory, "test.db"));
    const app = buildApp(repository);
    cleanups.push(() => {
      void app.close();
      repository.db.close();
      rmSync(directory, { recursive: true, force: true });
    });

    const session = await app.inject({ method: "POST", url: "/api/library-sessions" });
    const libraryToken = (session.json() as { libraryToken: string }).libraryToken;
    const otherSession = await app.inject({ method: "POST", url: "/api/library-sessions" });
    const otherToken = (otherSession.json() as { libraryToken: string }).libraryToken;
    const headers = { "x-library-token": libraryToken };

    const created = await app.inject({ method: "POST", url: "/api/games", headers });
    const createdBody = created.json() as { gameId: string; playerToken: string };
    const gameId = createdBody.gameId;
    const secondCreated = await app.inject({ method: "POST", url: "/api/games", headers });
    const secondGameId = (secondCreated.json() as { gameId: string }).gameId;
    const completedState = createGame({ gameId: "completed-replay", seed: 19, humanSeatId: "seat-1" });
    completedState.phase = "game_over";
    completedState.winner = "village";
    completedState.events.push(
      { seq: 3, type: "speech.delta", visibility: "public", round: 1, createdAt: Date.now(), payload: { seatId: "seat-1", delta: "隐藏流式片段" } } satisfies GameEvent,
      { seq: 4, type: "speech.completed", visibility: "public", round: 1, createdAt: Date.now(), payload: { seatId: "seat-1", text: "完整发言" } } satisfies GameEvent
    );
    repository.createGame(completedState, libraryToken, "复盘测试");
    repository.saveState(completedState);
    expect((await app.inject({ method: "GET", url: "/api/saves", headers })).json().saves).toHaveLength(3);
    expect((await app.inject({ method: "GET", url: "/api/saves", headers: { "x-library-token": otherToken } })).json().saves).toHaveLength(0);

    const activeReplay = await app.inject({ method: "GET", url: `/api/saves/${gameId}/replay`, headers });
    expect(activeReplay.statusCode).toBe(409);
    const replay = await app.inject({ method: "GET", url: "/api/saves/completed-replay/replay", headers });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().players[0]).toHaveProperty("role");
    expect(replay.json().events.some((event: GameEvent) => event.type === "speech.delta")).toBe(false);
    expect(replay.json().events.some((event: GameEvent) => event.type === "speech.completed")).toBe(true);

    const renamed = await app.inject({ method: "PATCH", url: `/api/saves/${gameId}`, headers, payload: { name: "我的第一局" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().save.name).toBe("我的第一局");

    expect((await app.inject({ method: "DELETE", url: `/api/saves/${gameId}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/saves", headers })).json().saves).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/api/saves/trash", headers })).json().saves).toHaveLength(1);

    expect((await app.inject({ method: "POST", url: `/api/saves/${gameId}/restore`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/saves", headers })).json().saves).toHaveLength(3);
    expect((await app.inject({ method: "DELETE", url: `/api/saves/${gameId}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/saves/${gameId}/permanent`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/saves/trash", headers })).json().saves).toHaveLength(0);
    expect(repository.loadGame(gameId)).toBeUndefined();
    expect(repository.getSession(createdBody.playerToken)).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/api/games/${secondGameId}/state`, headers: { "x-player-token": (secondCreated.json() as { playerToken: string }).playerToken } })).statusCode).toBe(200);
  });

  it("restores save metadata and state after a SQLite repository restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-restart-test-"));
    const databasePath = join(directory, "test.db");
    const firstRepository = new GameRepository(databasePath);
    const libraryToken = firstRepository.createLibrarySession();
    const state = createGame({ gameId: "restart-game", seed: 41, humanSeatId: "seat-1" });
    state.round = 3;
    state.phase = "day_vote";
    firstRepository.createGame(state, libraryToken, "重启后仍在");
    firstRepository.saveState(state);
    firstRepository.db.close();

    const secondRepository = new GameRepository(databasePath);
    expect(secondRepository.loadOwnedGame("restart-game", libraryToken)).toMatchObject({ round: 3, phase: "day_vote" });
    expect(secondRepository.listSaves(libraryToken)[0]).toMatchObject({ name: "重启后仍在", round: 3, phase: "day_vote", playerCount: 12 });
    secondRepository.db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("migrates legacy games without assigning them to a browser library", () => {
    const directory = mkdtempSync(join(tmpdir(), "werewolf-migration-test-"));
    const databasePath = join(directory, "test.db");
    const legacyState = createGame({ gameId: "legacy-game", seed: 7, humanSeatId: "seat-1" });
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec("CREATE TABLE games (id TEXT PRIMARY KEY, phase TEXT NOT NULL, round INTEGER NOT NULL, state_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    legacyDatabase.prepare("INSERT INTO games (id, phase, round, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(legacyState.gameId, legacyState.phase, legacyState.round, JSON.stringify(legacyState), 1, 2);
    legacyDatabase.close();

    const repository = new GameRepository(databasePath);
    const libraryToken = repository.createLibrarySession();
    expect(repository.loadGame("legacy-game")).toMatchObject({ gameId: "legacy-game" });
    expect(repository.listSaves(libraryToken)).toHaveLength(0);
    repository.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
