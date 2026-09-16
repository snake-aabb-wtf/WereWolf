import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

    const created = await app.inject({ method: "POST", url: "/api/games", payload: { seed: 123 } });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { gameId: string; playerToken: string; state: Record<string, unknown> };
    expect(body.playerToken).toBeTruthy();
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
});
