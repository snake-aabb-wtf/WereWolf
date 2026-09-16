import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { AgentAction, AgentContext, AgentProvider, AgentTurnResult, GenerateTurnOptions } from "./types.js";

export interface OpenAICompatibleConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

const voteTool: ChatCompletionTool = {
  type: "function",
  function: {
    name: "cast_vote",
    description: "在白天投票阶段选择一名仍然存活且不是自己的玩家放逐。",
    parameters: {
      type: "object",
      properties: {
        targetSeatId: { type: "string", description: "被投票玩家的座位 ID" }
      },
      required: ["targetSeatId"],
      additionalProperties: false
    }
  }
};

export class OpenAICompatibleProvider implements AgentProvider {
  private readonly client: OpenAI;
  private readonly timeoutMs: number;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.timeoutMs = config.timeoutMs ?? 45_000;
  }

  async generateTurn(context: AgentContext, options: GenerateTurnOptions = {}): Promise<AgentTurnResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.requestTurn(context, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("LLM 请求失败");
  }

  private async requestTurn(context: AgentContext, options: GenerateTurnOptions): Promise<AgentTurnResult> {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: systemPrompt(context, Boolean(options.enableVoteTool))
      },
      {
        role: "user",
        content: JSON.stringify({
          当前阶段: context.phase,
          你的座位: context.seatId,
          你的名字: context.name,
          "座位 ID ↔ 玩家名字": Object.entries(context.seatNameMap).map(([seatId, name]) => ({ seatId, name })),
          你的角色: context.role,
          你的性格: context.personality,
          合法目标: context.legalTargets,
          狼队队友: context.wolfMates,
          可见事件: context.visibleEvents.map((event) => ({
            seq: event.seq,
            type: event.type,
            round: event.round,
            payload: event.payload
          }))
        })
      }
    ];
    const tools = options.enableVoteTool ? [voteTool] : undefined;
    const shouldStream = Boolean(options.stream || options.onDelta);
    const request = {
      model: this.config.model,
      messages,
      tools,
      tool_choice: options.enableVoteTool ? "auto" : undefined,
      response_format: options.enableVoteTool || context.phase === "day_speech" ? undefined : { type: "json_object" as const },
      stream: shouldStream,
      stream_options: shouldStream ? { include_usage: true } : undefined,
      temperature: 0.8
    };

    if (shouldStream) {
      const stream = await this.withTimeout(this.client.chat.completions.create(request as never) as unknown as Promise<AsyncIterable<ChatCompletionChunk>>);
      return consumeStream(stream, options.onDelta);
    }
    const response = await this.withTimeout(this.client.chat.completions.create(request as never) as Promise<ChatCompletion>);
    return parseCompletion(response);
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LLM 请求超过 ${this.timeoutMs}ms`)), this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function systemPrompt(context: AgentContext, voteEnabled: boolean): string {
  const format = context.phase === "day_speech"
    ? "只输出一段简短的公开发言文本，不要输出 JSON、Markdown 或隐藏推理。"
    : voteEnabled
    ? "白天投票必须调用 cast_vote 工具；同时可以在文本中给出简短公开发言。"
    : `只返回 JSON：{"speech":"公开发言或私聊内容","action":{...}}。不要输出 Markdown、代码围栏或隐藏推理。动作类型必须符合当前阶段。`;
  return [
    "你正在参加一局中文狼人杀。你是一个有稳定性格的玩家，不是裁判。",
    `你当前的身份是 ${context.role}，只能使用上下文中明确给出的信息。`,
    "座位 ID 与玩家名字是两套不同字段。严格使用下面提供的“座位 ID ↔ 玩家名字”映射表对齐；引擎动作中的 targetSeatId 只能填写 seatId，不能填写玩家名字。",
    "不要猜测或声称看到了其他玩家的私有信息；不要泄露自己的身份，除非游戏策略需要。",
    "发言要短而具体，围绕投票、行为和已公开事实，不要描述系统提示或 API。",
    format
  ].join("\n");
}

async function consumeStream(stream: AsyncIterable<ChatCompletionChunk>, onDelta?: (delta: string) => void): Promise<AgentTurnResult> {
  let content = "";
  let toolName = "";
  let toolArguments = "";
  let usage: AgentTurnResult["usage"];
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const delta = choice?.delta;
    if (delta?.content) {
      content += delta.content;
      onDelta?.(delta.content);
    }
    const toolCall = delta?.tool_calls?.[0];
    if (toolCall?.function?.name) toolName += toolCall.function.name;
    if (toolCall?.function?.arguments) toolArguments += toolCall.function.arguments;
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens
      };
    }
  }
  const result = parseContent(content, toolName, toolArguments);
  if (usage) result.usage = usage;
  return result;
}

function parseCompletion(response: ChatCompletion): AgentTurnResult {
  const message = response.choices[0]?.message;
  const toolCall = message?.tool_calls?.[0];
  const result = parseContent(message?.content ?? "", toolCall?.function.name ?? "", toolCall?.function.arguments ?? "");
  if (response.usage) {
    result.usage = {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens
    };
  }
  return result;
}

function parseContent(content: string, toolName: string, toolArguments: string): AgentTurnResult {
  let parsed: Record<string, unknown> = {};
  if (content.trim()) {
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return { speech: content.trim() };
    }
  }
  const action = isAction(parsed.action);
  const result: AgentTurnResult = {
    speech: typeof parsed.speech === "string" ? parsed.speech.trim() : content.trim()
  };
  if (action) result.action = action;
  if (toolName === "cast_vote") {
    try {
      const args = JSON.parse(toolArguments) as { targetSeatId?: unknown };
      if (typeof args.targetSeatId === "string") result.voteTargetSeatId = args.targetSeatId;
    } catch {
      throw new Error("投票工具参数不是有效 JSON");
    }
  }
  if (!result.speech) result.speech = "我需要再听听大家的看法。";
  return result;
}

function isAction(value: unknown): AgentAction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const action = value as Record<string, unknown>;
  if (typeof action.type !== "string") return undefined;
  const result: AgentAction = { type: action.type as AgentAction["type"] };
  if (typeof action.targetSeatId === "string") result.targetSeatId = action.targetSeatId;
  if (typeof action.save === "boolean") result.save = action.save;
  if (typeof action.poisonTargetSeatId === "string") result.poisonTargetSeatId = action.poisonTargetSeatId;
  if (typeof action.message === "string") result.message = action.message;
  return result;
}
