import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameEvent, GameState } from "@werewolf/domain";

interface SessionRow {
  seat_id: string;
}

interface MaxSeqRow {
  max_seq: number;
}

export class GameRepository {
  readonly db: DatabaseSync;

  constructor(databasePath = resolve(process.env.DATABASE_PATH ?? "./data/werewolf.db")) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        phase TEXT NOT NULL,
        round INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_events (
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        visibility_json TEXT NOT NULL,
        round INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, seq)
      );
      CREATE TABLE IF NOT EXISTS agent_turns (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        seat_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        usage_json TEXT,
        error TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_sessions (
        token_hash TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        seat_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_commands (
        game_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, request_id)
      );
    `);
  }

  createGame(state: GameState): void {
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO games (id, phase, round, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(state.gameId, state.phase, state.round, JSON.stringify(state), now, now);
    this.insertEvents(state.gameId, state.events);
  }

  saveState(state: GameState): void {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE games SET phase = ?, round = ?, state_json = ?, updated_at = ? WHERE id = ?")
        .run(state.phase, state.round, JSON.stringify(state), now, state.gameId);
      const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM game_events WHERE game_id = ?")
        .get(state.gameId) as unknown as MaxSeqRow;
      this.insertEvents(state.gameId, state.events.filter((event) => event.seq > row.max_seq));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  loadGame(gameId: string): GameState | undefined {
    const row = this.db.prepare("SELECT state_json FROM games WHERE id = ?").get(gameId) as unknown as { state_json?: string } | undefined;
    if (!row?.state_json) return undefined;
    return JSON.parse(row.state_json) as GameState;
  }

  createSession(gameId: string, seatId: string): string {
    const token = randomUUID();
    this.db.prepare("INSERT INTO player_sessions (token_hash, game_id, seat_id, created_at) VALUES (?, ?, ?, ?)")
      .run(hashToken(token), gameId, seatId, Date.now());
    return token;
  }

  getSession(token: string): { gameId: string; seatId: string } | undefined {
    const row = this.db.prepare("SELECT game_id, seat_id FROM player_sessions WHERE token_hash = ?")
      .get(hashToken(token)) as unknown as (SessionRow & { game_id: string }) | undefined;
    if (!row) return undefined;
    return { gameId: row.game_id, seatId: row.seat_id };
  }

  hasProcessedCommand(gameId: string, requestId: string): boolean {
    const row = this.db.prepare("SELECT 1 AS found FROM processed_commands WHERE game_id = ? AND request_id = ?")
      .get(gameId, requestId) as unknown as { found?: number } | undefined;
    return Boolean(row?.found);
  }

  markCommandProcessed(gameId: string, requestId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO processed_commands (game_id, request_id, created_at) VALUES (?, ?, ?)")
      .run(gameId, requestId, Date.now());
  }

  recordAgentTurn(input: {
    gameId: string;
    seatId: string;
    phase: string;
    status: "completed" | "fallback" | "error";
    usage?: unknown;
    error?: string;
  }): void {
    this.db.prepare(
      "INSERT INTO agent_turns (id, game_id, seat_id, phase, status, usage_json, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      input.gameId,
      input.seatId,
      input.phase,
      input.status,
      input.usage ? JSON.stringify(input.usage) : null,
      input.error ?? null,
      Date.now()
    );
  }

  private insertEvents(gameId: string, events: GameEvent[]): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO game_events (game_id, seq, type, visibility_json, round, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const event of events) {
      insert.run(
        gameId,
        event.seq,
        event.type,
        JSON.stringify(event.visibility),
        event.round,
        JSON.stringify(event.payload),
        event.createdAt
      );
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
