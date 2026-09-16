import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { GameRepository } from "./db.js";
import { GameManager } from "./game-manager.js";

const COMMAND_TYPES = [
  "wolf.propose",
  "guard.protect",
  "seer.inspect",
  "witch.resolve",
  "speech.submit",
  "vote.cast",
  "hunter.shoot"
] as const;

type CommandType = (typeof COMMAND_TYPES)[number];

export function buildApp(repository = new GameRepository()): FastifyInstance {
  const manager = new GameManager(repository);
  const app = Fastify({ logger: true });

  void app.register(cors, { origin: true });

  app.get("/api/health", async () => ({ ok: true, service: "werewolf-server" }));

  app.post("/api/library-sessions", async (_request, reply) => {
    return reply.code(201).send({ libraryToken: manager.createLibrarySession() });
  });

  app.get("/api/saves", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    try {
      return reply.send({ saves: manager.listSaves(libraryToken) });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.get("/api/saves/trash", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    try {
      return reply.send({ saves: manager.listSaves(libraryToken, true) });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.post("/api/games", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const body = (request.body ?? {}) as { seed?: unknown };
    const seed = typeof body.seed === "number" && Number.isFinite(body.seed) ? Math.trunc(body.seed) : undefined;
    try {
      return reply.code(201).send(manager.create(seed, libraryToken));
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.post("/api/saves/:gameId/resume", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const { gameId } = request.params as { gameId: string };
    try {
      return reply.send(manager.resume(gameId, libraryToken));
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.get("/api/saves/:gameId/replay", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const { gameId } = request.params as { gameId: string };
    try {
      return reply.send(manager.replay(gameId, libraryToken));
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.patch("/api/saves/:gameId", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const { gameId } = request.params as { gameId: string };
    const body = (request.body ?? {}) as { name?: unknown };
    try {
      return reply.send({ save: manager.renameSave(gameId, libraryToken, typeof body.name === "string" ? body.name : "") });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.post("/api/saves/:gameId/restore", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const { gameId } = request.params as { gameId: string };
    try {
      return reply.send({ save: manager.restoreSave(gameId, libraryToken) });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.delete("/api/saves/:gameId/permanent", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const { gameId } = request.params as { gameId: string };
    try {
      manager.permanentlyDeleteSave(gameId, libraryToken);
      return reply.send({ ok: true });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.delete("/api/saves/:gameId", async (request, reply) => {
    const libraryToken = libraryTokenFrom(request, reply);
    if (!libraryToken) return;
    const { gameId } = request.params as { gameId: string };
    try {
      manager.deleteSave(gameId, libraryToken);
      return reply.send({ ok: true });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });

  app.get("/api/games/:gameId/state", async (request, reply) => {
    const params = request.params as { gameId: string };
    const seatId = authenticate(manager, request, params.gameId, reply);
    if (!seatId) return;
    return reply.send(manager.getPublicState(params.gameId, seatId));
  });

  app.post("/api/games/:gameId/commands", async (request, reply) => {
    const params = request.params as { gameId: string };
    const seatId = authenticate(manager, request, params.gameId, reply);
    if (!seatId) return;
    const body = (request.body ?? {}) as { requestId?: unknown; type?: unknown; payload?: unknown };
    if (typeof body.requestId !== "string" || !isCommandType(body.type)) {
      return reply.code(400).send({ error: "requestId 和合法 command type 是必需的" });
    }
    try {
      const state = await manager.command(params.gameId, seatId, body.requestId, body.type, body.payload);
      return reply.send(state);
    } catch (error) {
      const status = error instanceof Error && "code" in error ? 422 : 409;
      const code = error instanceof Error && "code" in error ? String((error as Error & { code: unknown }).code) : "COMMAND_REJECTED";
      return reply.code(status).send({ error: error instanceof Error ? error.message : "命令被拒绝", code });
    }
  });

  app.get("/api/games/:gameId/events", async (request, reply) => {
    const params = request.params as { gameId: string };
    const query = request.query as { token?: string };
    const seatId = authenticate(manager, request, params.gameId, reply, query.token);
    if (!seatId) return;
    const lastEventId = Number(request.headers["last-event-id"] ?? 0);
    const afterSeq = Number.isFinite(lastEventId) ? lastEventId : 0;
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*"
    });
    const writeEvent = (event: import("@werewolf/domain").GameEvent) => {
      raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    manager.eventsAfter(params.gameId, seatId, afterSeq).forEach(writeEvent);
    const unsubscribe = manager.subscribe(params.gameId, seatId, writeEvent);
    const heartbeat = setInterval(() => raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return app;
}

function authenticate(manager: GameManager, request: FastifyRequest, gameId: string, reply: FastifyReply, queryToken?: string): string | undefined {
  const tokenHeader = request.headers["x-player-token"];
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  const candidate = typeof token === "string" ? token : queryToken;
  const seatId = typeof candidate === "string" ? manager.authenticate(gameId, candidate) : undefined;
  if (!seatId) {
    void reply.code(401).send({ error: "缺少有效的玩家会话" });
    return undefined;
  }
  return seatId;
}

function libraryTokenFrom(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const header = request.headers["x-library-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token === "string" && token.trim()) return token;
  void reply.code(401).send({ error: "缺少有效的浏览器玩家会话", code: "LIBRARY_UNAUTHORIZED" });
  return undefined;
}

function sendManagerError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error && "code" in error ? String((error as Error & { code: unknown }).code) : "SAVE_OPERATION_REJECTED";
  const status = code === "LIBRARY_UNAUTHORIZED" ? 401 : code === "SAVE_NOT_FOUND" || code === "REPLAY_NOT_FOUND" ? 404 : 409;
  return reply.code(status).send({ error: error instanceof Error ? error.message : "存档操作被拒绝", code });
}

function isCommandType(value: unknown): value is CommandType {
  return typeof value === "string" && (COMMAND_TYPES as readonly string[]).includes(value);
}
