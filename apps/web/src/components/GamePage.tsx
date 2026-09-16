import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { PublicState } from "@werewolf/domain";
import { ActionPanel } from "./ActionPanel";
import { ConversationTimeline } from "./ConversationTimeline";
import { phaseNames } from "./game-data";
import { GameTable } from "./GameTable";
import { IdentityCard } from "./IdentityCard";
import { useGameSession } from "../hooks/useGameSession";

export function GamePage({ libraryToken }: { libraryToken: string }) {
  const { gameId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const initialPlayerToken = (location.state as { playerToken?: string } | null)?.playerToken;
  const session = useGameSession(gameId, libraryToken, initialPlayerToken);
  const [target, setTarget] = useState("");
  const [speech, setSpeech] = useState("");
  const [witchChoice, setWitchChoice] = useState<"none" | "save" | "poison">("none");

  const streaming = useMemo(() => collectStreaming(session.game?.events ?? []), [session.game?.events]);
  if (!session.game) return <LoadingPage error={session.error} />;

  const game = session.game;
  const canAct = game.human.canAct && !session.loading;
  const timeline = game.events.filter((event) => event.type !== "speech.delta");
  return <main className="app-shell">
    <header className="topbar"><div className="brand-lockup"><span className="brand-mark">✦</span><span>暗桌 / WEREWOLF</span></div><div className="game-nav"><Link className="back-link" to="/">← 存档库</Link><span className="autosave-status"><span className="live-dot">●</span>{session.lastSavedAt ? "已自动保存" : "正在同步"}</span><span>第 {game.round} 夜</span></div></header>
    <div className="game-layout">
      <section className="stage-column">
        <div className="stage-heading"><div><p className="eyebrow">CURRENT PHASE</p><h1>{phaseNames[game.phase]}</h1></div><p className="stage-note">事实由裁判记录<br />发言由玩家留下</p></div>
        <GameTable game={game} />
        <section className="conversation-panel"><div className="panel-heading"><div><p className="eyebrow">PUBLIC RECORD</p><h2>桌面记录</h2></div><span className="record-count">{timeline.length.toString().padStart(2, "0")} EVENTS</span></div>{streaming.size > 0 && <div className="streaming-stack">{[...streaming.entries()].map(([seatId, text]) => <div className="streaming-line" key={seatId}><span className="pulse" />{playerName(game, seatId)} <span>{text}</span></div>)}</div>}<ConversationTimeline events={game.events} players={game.players} /></section>
      </section>
      <aside className="control-rail"><IdentityCard game={game} /><section className="action-card"><div className="card-kicker">YOUR MOVE</div>{game.phase === "game_over" ? <GameOver game={game} onReplay={() => navigate(`/replay/${game.gameId}`)} /> : <ActionPanel game={game} canAct={canAct} target={target} setTarget={setTarget} speech={speech} setSpeech={setSpeech} witchChoice={witchChoice} setWitchChoice={setWitchChoice} sendCommand={session.sendCommand} />}</section><div className="rail-footnote"><span className="footnote-rule" />第 {game.round} 轮 · 事件日志已存入本地 SQLite<br />你能看见的，只有你应该看见的。</div>{session.error && <div className="error-banner" role="alert">{session.error}</div>}</aside>
    </div>
  </main>;
}

function GameOver({ game, onReplay }: { game: PublicState; onReplay: () => void }) {
  return <div className="game-over"><span className="result-star">✦</span><h3>{game.winner === "village" ? "村庄醒来了" : "狼群接管了夜色"}</h3><p>{game.winner === "village" ? "你们找到了所有伪装者。" : "最后的票型已经无法挽回。"}</p><button className="secondary-button" onClick={onReplay}>打开完整复盘 <span>→</span></button></div>;
}

function LoadingPage({ error }: { error: string }) {
  return <main className="center-page"><div className="waiting-state"><span className="waiting-orb" /><h3>{error ? "存档没有回应。" : "正在找回牌桌。"}</h3><p>{error || "正在恢复你的匿名玩家会话。"}</p><Link className="secondary-button inline-button" to="/">返回存档库 <span>←</span></Link></div></main>;
}

function collectStreaming(events: PublicState["events"]): Map<string, string> {
  const latest = new Map<string, { seq: number; text: string }>();
  const completed = new Map<string, number>();
  events.forEach((event) => {
    const seatId = String(event.payload.seatId ?? "");
    if (event.type === "speech.completed") completed.set(seatId, event.seq);
    if (event.type === "speech.delta") {
      const previous = latest.get(seatId);
      latest.set(seatId, { seq: event.seq, text: `${previous && previous.seq > (completed.get(seatId) ?? 0) ? previous.text : ""}${String(event.payload.delta ?? "")}` });
    }
  });
  return new Map([...latest.entries()].filter(([seatId, item]) => item.seq > (completed.get(seatId) ?? 0)).map(([seatId, item]) => [seatId, item.text]));
}

function playerName(game: PublicState, seatId: string): string {
  return game.players.find((player) => player.seatId === seatId)?.name ?? seatId;
}
