import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../src/index.js";
import type { AgentContext } from "../src/index.js";

const context: AgentContext = {
  gameId: "prompt-test",
  round: 1,
  phase: "seer_action",
  seatId: "seat-2",
  name: "阿岚",
  seatNameMap: {
    "seat-1": "你",
    "seat-2": "阿岚",
    "seat-3": "白榆"
  },
  role: "seer",
  personality: "冷静",
  visibleEvents: [],
  legalTargets: ["seat-1", "seat-3"],
  wolfMates: [],
  kind: "seer",
  fallbackSeed: 1
};

describe("OpenAICompatibleProvider prompt contract", () => {
  it("sends a separate seat ID to player name mapping table", async () => {
    let requestBody: { messages: Array<{ role: string; content: string }> } | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Array<{ role: string; content: string }> };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "chatcmpl-prompt-test",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, message: { role: "assistant", content: '{"speech":"我会先核对名字和座位。"}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务器没有分配端口");

    try {
      await new OpenAICompatibleProvider({ baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-key", model: "test-model" }).generateTurn(context);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    expect(requestBody).toBeDefined();
    const systemPrompt = requestBody?.messages.find((message) => message.role === "system")?.content ?? "";
    const userPrompt = requestBody?.messages.find((message) => message.role === "user")?.content ?? "";
    expect(systemPrompt).toContain("座位 ID ↔ 玩家名字");
    expect(systemPrompt).toContain("targetSeatId");
    expect(userPrompt).toContain("座位 ID ↔ 玩家名字");
    expect(userPrompt).toContain('"seatId":"seat-3"');
    expect(userPrompt).toContain('"name":"白榆"');
    expect(userPrompt).toContain('"你的名字":"阿岚"');
  });
});
