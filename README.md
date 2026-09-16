# WereWolf LLM

一个由 LLM 驱动的中文狼人杀单机 MVP：1 名真人 + 11 名 AI，共 12 人。

默认采用“4 狼 + 预言家、女巫、猎人、守卫 + 4 村民”的常见配置。守卫每晚可保护一名存活玩家（允许自守和连续守同一人），保护只抵消狼刀，不抵消女巫毒；四名狼人全部提交目标后统一结算。

需要 Node.js 22+（服务端使用内置 `node:sqlite`）。

## 快速开始

```bash
npm install
copy .env.example .env
npm run dev
```

浏览器打开 <http://localhost:5173>。如果没有配置 `LLM_API_KEY`，服务端会使用确定性的 Fake Agent，让完整 12 人游戏流程仍然可演示和测试。

`npm run dev` 会先构建共享包和服务端，再同时启动编译后的 Fastify 服务与 Vite 前端。

## 结构

- `packages/domain`：纯 TypeScript 游戏规则引擎与共享类型。
- `packages/llm`：OpenAI Chat Completions 兼容 API 适配层和 Fake Provider。
- `apps/server`：Fastify API、SSE、SQLite 持久化和 AI 回合调度。
- `apps/web`：React + Vite 主菜单、进行中牌局、只读复盘和回收站界面；存档按匿名浏览器会话隔离并自动保存。

## 页面与存档

- `/`：存档库主菜单，可创建多局牌局、继续进行中牌局、重命名或移入回收站。
- `/game/:gameId`：进行中的牌局，离开页面后可从主菜单继续。
- `/replay/:gameId`：已结束牌局的只读完整复盘，包含身份和隐藏事件。
- `/trash`：软删除存档的恢复和永久删除入口。

首次打开页面会由服务端签发匿名浏览器令牌，浏览器只在 `localStorage` 保存令牌本身，SQLite 只保存其哈希。每次新建牌局、领域状态变化和 AI 发言都会更新对应快照。

## 验证

```bash
npm test
npm run typecheck
npm run build
```
