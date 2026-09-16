import type { GameEvent, PublicState, ReplayState, SaveSummary } from "@werewolf/domain";

export interface GameSessionResponse {
  gameId: string;
  playerToken: string;
  humanSeatId: string;
  state: PublicState;
  save: SaveSummary;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
  if (!response.ok) throw new ApiError(body.error ?? "请求失败", response.status, body.code);
  return body as T;
}

function libraryHeaders(token: string, json = false): HeadersInit {
  return { ...(json ? { "content-type": "application/json" } : {}), "x-library-token": token };
}

export const libraryApi = {
  async createSession(): Promise<string> {
    const body = await request<{ libraryToken: string }>("/api/library-sessions", { method: "POST" });
    return body.libraryToken;
  },
  async listSaves(token: string, trash = false): Promise<SaveSummary[]> {
    const body = await request<{ saves: SaveSummary[] }>(trash ? "/api/saves/trash" : "/api/saves", {
      headers: libraryHeaders(token)
    });
    return body.saves;
  }
};

export const gameApi = {
  create(token: string, seed?: number): Promise<GameSessionResponse> {
    return request<GameSessionResponse>("/api/games", {
      method: "POST",
      headers: libraryHeaders(token, true),
      body: JSON.stringify(seed === undefined ? {} : { seed })
    });
  },
  getState(gameId: string, playerToken: string): Promise<PublicState> {
    return request<PublicState>(`/api/games/${gameId}/state`, { headers: { "x-player-token": playerToken } });
  },
  command(gameId: string, playerToken: string, type: string, payload: Record<string, unknown>): Promise<PublicState> {
    return request<PublicState>(`/api/games/${gameId}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-player-token": playerToken },
      body: JSON.stringify({ requestId: crypto.randomUUID(), type, payload })
    });
  }
};

export const saveApi = {
  resume(token: string, gameId: string): Promise<GameSessionResponse> {
    return request<GameSessionResponse>(`/api/saves/${gameId}/resume`, {
      method: "POST",
      headers: libraryHeaders(token)
    });
  },
  replay(token: string, gameId: string): Promise<ReplayState> {
    return request<ReplayState>(`/api/saves/${gameId}/replay`, { headers: libraryHeaders(token) });
  },
  rename(token: string, gameId: string, name: string): Promise<SaveSummary> {
    return request<{ save: SaveSummary }>(`/api/saves/${gameId}`, {
      method: "PATCH",
      headers: libraryHeaders(token, true),
      body: JSON.stringify({ name })
    }).then((body) => body.save);
  },
  remove(token: string, gameId: string): Promise<void> {
    return request<{ ok: true }>(`/api/saves/${gameId}`, { method: "DELETE", headers: libraryHeaders(token) }).then(() => undefined);
  },
  restore(token: string, gameId: string): Promise<SaveSummary> {
    return request<{ save: SaveSummary }>(`/api/saves/${gameId}/restore`, { method: "POST", headers: libraryHeaders(token) }).then((body) => body.save);
  },
  permanentlyDelete(token: string, gameId: string): Promise<void> {
    return request<{ ok: true }>(`/api/saves/${gameId}/permanent`, { method: "DELETE", headers: libraryHeaders(token) }).then(() => undefined);
  }
};

export const eventTypes: GameEvent["type"][] = [
  "game.started",
  "phase.changed",
  "wolf.proposal",
  "guard.result",
  "seer.result",
  "witch.result",
  "speech.delta",
  "speech.completed",
  "vote.cast",
  "player.eliminated",
  "hunter.prompt",
  "game.over",
  "agent.error"
];
