# WereWolf LLM

一个由 LLM 驱动的中文狼人杀单机 MVP：1 名真人 + 7 名 AI。

需要 Node.js 22+（服务端使用内置 `node:sqlite`）。

## 快速开始

```bash
npm install
copy .env.example .env
npm run dev
```

浏览器打开 <http://localhost:5173>。如果没有配置 `LLM_API_KEY`，服务端会使用确定性的 Fake Agent，让完整游戏流程仍然可演示和测试。

`npm run dev` 会先构建共享包和服务端，再同时启动编译后的 Fastify 服务与 Vite 前端。

## 结构

- `packages/domain`：纯 TypeScript 游戏规则引擎与共享类型。
- `packages/llm`：OpenAI Chat Completions 兼容 API 适配层和 Fake Provider。
- `apps/server`：Fastify API、SSE、SQLite 持久化和 AI 回合调度。
- `apps/web`：React + Vite 游戏桌面。

## 验证

```bash
npm test
npm run typecheck
npm run build
```
