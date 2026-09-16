import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { GameEvent, GameState, ReplayState, SaveSummary } from "@werewolf/domain";

interface SessionRow {
  seat_id: string;
}

interface MaxSeqRow {
  max_seq: number;
}

interface ColumnRow {
  name: string;
}

interface GameRow {
  id: string;
  phase: string;
  round: number;
  state_json: string;
  created_at: number;
  updated_at: number;
  owner_token_hash?: string | null;
  save_name?: string | null;
  save_status?: string | null;
  winner?: string | null;
  last_played_at?: number | null;
  deleted_at?: number | null;
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
        updated_at INTEGER NOT NULL,
        owner_token_hash TEXT,
        save_name TEXT NOT NULL DEFAULT '旧存档',
        save_status TEXT NOT NULL DEFAULT 'in_progress',
        winner TEXT,
        last_played_at INTEGER,
        deleted_at INTEGER
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
      CREATE TABLE IF NOT EXISTS player_library_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
    `);
    this.migrateGamesTable();
  }

  createLibrarySession(): string {
    const token = randomUUID();
    const now = Date.now();
    this.db.prepare("INSERT INTO player_library_sessions (token_hash, created_at, last_seen_at) VALUES (?, ?, ?)")
      .run(hashToken(token), now, now);
    return token;
  }

  hasLibrarySession(token: string): boolean {
    const row = this.db.prepare("SELECT 1 AS found FROM player_library_sessions WHERE token_hash = ?")
      .get(hashToken(token)) as unknown as { found?: number } | undefined;
    return Boolean(row?.found);
  }

  touchLibrarySession(token: string): boolean {
    const result = this.db.prepare("UPDATE player_library_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(Date.now(), hashToken(token)) as unknown as { changes?: number | bigint };
    return Number(result.changes ?? 0) > 0;
  }

  nextGameNumber(token: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM games WHERE owner_token_hash = ?")
      .get(hashToken(token)) as unknown as { count?: number | bigint } | undefined;
    return Number(row?.count ?? 0) + 1;
  }

  createGame(state: GameState, libraryToken: string, saveName: string): void {
    const now = Date.now();
    this.db.prepare(
      "INSERT INTO games (id, phase, round, state_json, created_at, updated_at, owner_token_hash, save_name, save_status, winner, last_played_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)"
    ).run(state.gameId, state.phase, state.round, JSON.stringify(state), now, now, hashToken(libraryToken), cleanSaveName(saveName), "in_progress", null, now);
    this.insertEvents(state.gameId, state.events);
  }

  saveState(state: GameState): void {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE games SET phase = ?, round = ?, state_json = ?, save_status = ?, winner = ?, last_played_at = ?, updated_at = ? WHERE id = ?")
        .run(state.phase, state.round, JSON.stringify(state), state.winner ? "completed" : "in_progress", state.winner ?? null, now, now, state.gameId);
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
    const row = this.db.prepare("SELECT state_json FROM games WHERE id = ?").get(gameId) as unknown as Pick<GameRow, "state_json"> | undefined;
    return row?.state_json ? parseGameState(row.state_json) : undefined;
  }

  loadOwnedGame(gameId: string, libraryToken: string): GameState | undefined {
    const row = this.getGameRow(gameId, libraryToken, false);
    return row ? parseGameState(row.state_json) : undefined;
  }

  listSaves(libraryToken: string, includeDeleted = false): SaveSummary[] {
    const hash = hashToken(libraryToken);
    const rows = this.db.prepare(
      `SELECT id, phase, round, state_json, created_at, updated_at, save_name, save_status, winner, last_played_at, deleted_at
       FROM games WHERE owner_token_hash = ? ${includeDeleted ? "AND deleted_at IS NOT NULL" : "AND deleted_at IS NULL"}
       ORDER BY COALESCE(last_played_at, updated_at) DESC, created_at DESC`
    ).all(hash) as unknown as GameRow[];
    return rows.map(toSaveSummary);
  }

  getSaveSummary(gameId: string, libraryToken: string, includeDeleted = false): SaveSummary | undefined {
    const row = this.getGameRow(gameId, libraryToken, includeDeleted);
    return row ? toSaveSummary(row) : undefined;
  }

  getReplay(gameId: string, libraryToken: string): ReplayState | undefined {
    const row = this.getGameRow(gameId, libraryToken, false);
    if (!row) return undefined;
    const state = parseGameState(row.state_json);
    if (!state.winner) return undefined;
    return {
      gameId: state.gameId,
      name: row.save_name ?? "旧存档",
      round: state.round,
      winner: state.winner,
      players: state.players,
      events: state.events.filter((event) => event.type !== "speech.delta")
    };
  }

  renameSave(gameId: string, libraryToken: string, name: string): SaveSummary | undefined {
    const row = this.getGameRow(gameId, libraryToken, false);
    if (!row) return undefined;
    this.db.prepare("UPDATE games SET save_name = ?, updated_at = ? WHERE id = ? AND owner_token_hash = ? AND deleted_at IS NULL")
      .run(cleanSaveName(name), Date.now(), gameId, hashToken(libraryToken));
    return this.getSaveSummary(gameId, libraryToken);
  }

  softDelete(gameId: string, libraryToken: string): boolean {
    const result = this.db.prepare("UPDATE games SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_token_hash = ? AND deleted_at IS NULL")
      .run(Date.now(), Date.now(), gameId, hashToken(libraryToken)) as unknown as { changes?: number | bigint };
    return Number(result.changes ?? 0) > 0;
  }

  restoreSave(gameId: string, libraryToken: string): boolean {
    const result = this.db.prepare("UPDATE games SET deleted_at = NULL, updated_at = ?, last_played_at = ? WHERE id = ? AND owner_token_hash = ? AND deleted_at IS NOT NULL")
      .run(Date.now(), Date.now(), gameId, hashToken(libraryToken)) as unknown as { changes?: number | bigint };
    return Number(result.changes ?? 0) > 0;
  }

  permanentlyDelete(gameId: string, libraryToken: string): boolean {
    const row = this.getGameRow(gameId, libraryToken, true);
    if (!row || row.deleted_at === null || row.deleted_at === undefined) return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM game_events WHERE game_id = ?").run(gameId);
      this.db.prepare("DELETE FROM agent_turns WHERE game_id = ?").run(gameId);
      this.db.prepare("DELETE FROM player_sessions WHERE game_id = ?").run(gameId);
      this.db.prepare("DELETE FROM processed_commands WHERE game_id = ?").run(gameId);
      const result = this.db.prepare("DELETE FROM games WHERE id = ? AND owner_token_hash = ? AND deleted_at IS NOT NULL")
        .run(gameId, hashToken(libraryToken)) as unknown as { changes?: number | bigint };
      this.db.exec("COMMIT");
      return Number(result.changes ?? 0) > 0;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
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

  private getGameRow(gameId: string, libraryToken: string, includeDeleted: boolean): GameRow | undefined {
    const deletedClause = includeDeleted ? "" : " AND deleted_at IS NULL";
    return this.db.prepare(
      `SELECT id, phase, round, state_json, created_at, updated_at, save_name, save_status, winner, last_played_at, deleted_at
       FROM games WHERE id = ? AND owner_token_hash = ?${deletedClause}`
    ).get(gameId, hashToken(libraryToken)) as unknown as GameRow | undefined;
  }

  private migrateGamesTable(): void {
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(games)").all() as unknown as ColumnRow[]).map((column) => column.name)
    );
    const additions: Record<string, string> = {
      owner_token_hash: "TEXT",
      save_name: "TEXT NOT NULL DEFAULT '旧存档'",
      save_status: "TEXT NOT NULL DEFAULT 'in_progress'",
      winner: "TEXT",
      last_played_at: "INTEGER",
      deleted_at: "INTEGER"
    };
    Object.entries(additions).forEach(([name, definition]) => {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE games ADD COLUMN ${name} ${definition}`);
    });
    this.db.prepare("UPDATE games SET last_played_at = updated_at WHERE last_played_at IS NULL").run();
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_games_owner ON games (owner_token_hash, deleted_at, last_played_at)");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseGameState(json: string): GameState {
  const state = JSON.parse(json) as GameState;
  // Snapshots created before the guard phase was introduced can still be read safely.
  state.night.guardResolved ??= false;
  return state;
}

function cleanSaveName(name: string): string {
  const value = name.trim().replace(/\s+/gu, " ").slice(0, 80);
  return value || "未命名暗桌";
}

function toSaveSummary(row: GameRow): SaveSummary {
  const state = parseGameState(row.state_json);
  const summary: SaveSummary = {
    gameId: state.gameId,
    name: row.save_name ?? "旧存档",
    status: state.winner ? "completed" : "in_progress",
    round: state.round,
    phase: state.phase,
    playerCount: state.players.length,
    aliveCount: state.players.filter((player) => player.status === "alive").length,
    createdAt: row.created_at,
    updatedAt: row.last_played_at ?? row.updated_at
  };
  if (state.winner) summary.winner = state.winner;
  if (row.deleted_at !== null && row.deleted_at !== undefined) summary.deletedAt = row.deleted_at;
  return summary;
}
