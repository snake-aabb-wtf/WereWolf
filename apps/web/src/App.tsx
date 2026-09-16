import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameEvent, PublicState, Role } from "@werewolf/domain";

const EVENT_TYPES: GameEvent["type"][] = [
  "game.started",
  "phase.changed",
  "wolf.proposal",
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

const phaseNames: Record<PublicState["phase"], string> = {
  lobby: "准备",
  wolf_discussion: "狼队密谈",
  seer_action: "预言家查验",
  witch_action: "女巫决策",
  day_speech: "依次发言",
  day_vote: "放逐投票",
  hunter_action: "猎人开枪",
  game_over: "游戏结束"
};

const roleNames: Record<Role, string> = {
  werewolf: "狼人",
  seer: "预言家",
  witch: "女巫",
  hunter: "猎人",
  villager: "村民"
};

interface StoredSession {
  gameId: string;
  token: string;
}

export default function App() {
  const [game, setGame] = useState<PublicState | null>(null);
  const [playerToken, setPlayerToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState("");
  const [speech, setSpeech] = useState("");
  const [witchChoice, setWitchChoice] = useState<"none" | "save" | "poison">("none");

  const refresh = useCallback(async (gameId: string, token: string) => {
    const response = await fetch(`/api/games/${gameId}/state`, { headers: { "x-player-token": token } });
    if (!response.ok) throw new Error("无法恢复游戏状态");
    const next = (await response.json()) as PublicState;
    setGame(next);
    return next;
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem("werewolf.session");
    if (!raw) return;
    try {
      const stored = JSON.parse(raw) as StoredSession;
      setPlayerToken(stored.token);
      void refresh(stored.gameId, stored.token).catch(() => sessionStorage.removeItem("werewolf.session"));
    } catch {
      sessionStorage.removeItem("werewolf.session");
    }
  }, [refresh]);

  useEffect(() => {
    if (!game || !playerToken) return;
    const source = new EventSource(`/api/games/${game.gameId}/events?token=${encodeURIComponent(playerToken)}`);
    const handleEvent = (message: Event) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as GameEvent;
      setGame((current) => {
        if (!current || current.events.some((candidate) => candidate.seq === event.seq)) return current;
        return { ...current, events: [...current.events, event].sort((left, right) => left.seq - right.seq) };
      });
      if (event.type !== "speech.delta") void refresh(game.gameId, playerToken).catch(() => undefined);
    };
    EVENT_TYPES.forEach((type) => source.addEventListener(type, handleEvent));
    source.onerror = () => setError("事件连接暂时中断，浏览器会自动重连。");
    return () => {
      EVENT_TYPES.forEach((type) => source.removeEventListener(type, handleEvent));
      source.close();
    };
  }, [game?.gameId, playerToken, refresh]);

  const startGame = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("创建游戏失败");
      const created = (await response.json()) as { gameId: string; playerToken: string; state: PublicState };
      setPlayerToken(created.playerToken);
      setGame(created.state);
      sessionStorage.setItem("werewolf.session", JSON.stringify({ gameId: created.gameId, token: created.playerToken } satisfies StoredSession));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建游戏失败");
    } finally {
      setLoading(false);
    }
  };

  const sendCommand = async (type: string, payload: Record<string, unknown>) => {
    if (!game || !playerToken) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/games/${game.gameId}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-player-token": playerToken },
        body: JSON.stringify({ requestId: crypto.randomUUID(), type, payload })
      });
      const body = (await response.json()) as PublicState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "操作未被接受");
      setGame(body);
      setTarget("");
      setSpeech("");
      setWitchChoice("none");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const streaming = useMemo(() => collectStreaming(game?.events ?? []), [game?.events]);
  const timeline = useMemo(() => game?.events.filter((event) => event.type !== "speech.delta") ?? [], [game?.events]);

  if (!game) return <Welcome loading={loading} error={error} onStart={startGame} />;

  const human = game.human;
  const canAct = human.canAct && !loading;
  const aliveTargets = game.players.filter((player) => player.status === "alive" && player.seatId !== human.seatId && !human.wolfMates?.includes(player.seatId));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark">✦</span><span>暗桌 / WEREWOLF</span></div>
        <div className="topbar-meta"><span>第 {game.round} 夜</span><span className="live-dot">●</span><span>单机牌局</span></div>
      </header>

      <div className="game-layout">
        <section className="stage-column">
          <div className="stage-heading">
            <div>
              <p className="eyebrow">CURRENT PHASE</p>
              <h1>{phaseNames[game.phase]}</h1>
            </div>
            <p className="stage-note">事实由裁判记录<br />发言由玩家留下</p>
          </div>

          <section className="table-panel" aria-label="玩家座位">
            <div className="table-rim"><span>THE NIGHT TABLE</span><span>08 SEATS / PRIVATE ROOM</span></div>
            <div className="player-grid">
              {game.players.map((player, index) => (
                <PlayerCard key={player.seatId} player={player} index={index} humanSeatId={human.seatId} />
              ))}
            </div>
            <div className="table-center"><span className="center-sigil">✦</span><span>保持怀疑</span></div>
          </section>

          <section className="conversation-panel">
            <div className="panel-heading"><div><p className="eyebrow">PUBLIC RECORD</p><h2>桌面记录</h2></div><span className="record-count">{timeline.length.toString().padStart(2, "0")} EVENTS</span></div>
            {streaming.size > 0 && <div className="streaming-stack">{[...streaming.entries()].map(([seatId, text]) => <div className="streaming-line" key={seatId}><span className="pulse" />{playerName(game, seatId)} <span>{text}</span></div>)}</div>}
            <div className="timeline" aria-live="polite">
              {timeline.slice(-32).map((event) => <TimelineEvent key={event.seq} event={event} game={game} />)}
              {timeline.length === 0 && <p className="empty-copy">牌桌还没有留下记录。</p>}
            </div>
          </section>
        </section>

        <aside className="control-rail">
          <section className="identity-card">
            <div className="card-kicker">你的身份 / PRIVATE</div>
            <div className="role-row"><span className={`role-seal role-${human.role}`}>{roleGlyph(human.role)}</span><div><span className="role-label">{human.faction === "werewolf" ? "WEREWOLF FACTION" : "VILLAGE FACTION"}</span><h2>{roleNames[human.role]}</h2></div></div>
            <p>{human.personality}</p>
            {human.wolfMates && human.wolfMates.length > 0 && <div className="mate-note">狼队同伴：{human.wolfMates.map((seatId) => playerName(game, seatId)).join("、")}</div>}
          </section>

          <section className="action-card">
            <div className="card-kicker">YOUR MOVE</div>
            {game.phase === "game_over" ? <GameOver winner={game.winner} onRestart={startGame} loading={loading} /> : <ActionPanel game={game} canAct={canAct} target={target} setTarget={setTarget} speech={speech} setSpeech={setSpeech} witchChoice={witchChoice} setWitchChoice={setWitchChoice} aliveTargets={aliveTargets} sendCommand={sendCommand} />}
          </section>

          <div className="rail-footnote"><span className="footnote-rule" />第 {game.round} 轮 · 事件日志已存入本地 SQLite<br />你能看见的，只有你应该看见的。</div>
          {error && <div className="error-banner" role="alert">{error}</div>}
        </aside>
      </div>
    </main>
  );
}

function Welcome({ loading, error, onStart }: { loading: boolean; error: string; onStart: () => void }) {
  return <main className="welcome-shell"><div className="welcome-copy"><p className="eyebrow">A PRIVATE TABLE FOR EIGHT</p><div className="hero-mark">✦</div><h1>每一句话<br /><em>都有立场。</em></h1><p className="welcome-description">八个座位，一张暗桌。和七个有记忆、会判断、也会撒谎的 AI 玩家，打一局完整的狼人杀。</p><button className="primary-button enter-button" disabled={loading} onClick={onStart}>{loading ? "正在点亮牌桌…" : "进入夜色"}<span>→</span></button>{error && <p className="error-copy">{error}</p>}</div><div className="welcome-side"><span>01</span><div className="side-line" /><p>确定性裁判<br />私有信息隔离<br />每局事件存档</p></div></main>;
}

function PlayerCard({ player, index, humanSeatId }: { player: PublicState["players"][number]; index: number; humanSeatId: string }) {
  return <article className={`player-card ${player.status === "dead" ? "is-dead" : ""} ${player.seatId === humanSeatId ? "is-human" : ""}`}><div className="player-top"><span className="seat-number">0{index + 1}</span><span className={`status-dot ${player.status}`} /></div><div className="avatar-placeholder">{player.name.slice(0, 1)}</div><strong>{player.name}</strong><small>{player.seatId === humanSeatId ? "YOU" : player.kind === "ai" ? "AI PLAYER" : "PLAYER"}</small>{player.status === "dead" && <span className="dead-stamp">OUT</span>}</article>;
}

function ActionPanel({ game, canAct, target, setTarget, speech, setSpeech, witchChoice, setWitchChoice, aliveTargets, sendCommand }: {
  game: PublicState;
  canAct: boolean;
  target: string;
  setTarget: (value: string) => void;
  speech: string;
  setSpeech: (value: string) => void;
  witchChoice: "none" | "save" | "poison";
  setWitchChoice: (value: "none" | "save" | "poison") => void;
  aliveTargets: PublicState["players"];
  sendCommand: (type: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  if (!canAct) return <div className="waiting-state"><span className="waiting-orb" /><h3>听着。</h3><p>AI 正在整理它们的发言，<br />轮到你时这里会亮起来。</p></div>;
  if (game.phase === "day_speech") return <><h3>轮到你说话。</h3><p className="action-hint">把怀疑留在桌面上。最多 800 字。</p><textarea value={speech} onChange={(event) => setSpeech(event.target.value)} placeholder="我注意到……" rows={6} /><button className="primary-button" disabled={!speech.trim()} onClick={() => void sendCommand("speech.submit", { text: speech })}>留下发言 <span>→</span></button></>;
  if (game.phase === "witch_action") return <><h3>夜色给你一瓶药。</h3><p className="action-hint">每夜最多使用一种。解药不能救自己。</p><div className="choice-list"><label className={witchChoice === "none" ? "selected" : ""}><input type="radio" checked={witchChoice === "none"} onChange={() => setWitchChoice("none")} />不使用</label><label className={witchChoice === "save" ? "selected" : ""}><input type="radio" checked={witchChoice === "save"} onChange={() => setWitchChoice("save")} />使用解药</label><label className={witchChoice === "poison" ? "selected" : ""}><input type="radio" checked={witchChoice === "poison"} onChange={() => setWitchChoice("poison")} />使用毒药</label></div>{witchChoice === "poison" && <TargetSelect value={target} onChange={setTarget} targets={aliveTargets} placeholder="选择毒药目标" />}{witchChoice === "save" && <div className="notice-strip">若今晚有人被狼袭击，你会尝试救下他。</div>}<button className="primary-button" disabled={witchChoice === "poison" && !target} onClick={() => void sendCommand("witch.resolve", { save: witchChoice === "save", poisonTargetSeatId: witchChoice === "poison" ? target : null })}>确认夜间决策 <span>→</span></button></>;
  if (game.phase === "wolf_discussion") return <><h3>狼队密谈。</h3><p className="action-hint">你的提议只会被狼队看见。</p><TargetSelect value={target} onChange={setTarget} targets={aliveTargets} placeholder="选择今晚的目标" /><textarea value={speech} onChange={(event) => setSpeech(event.target.value)} placeholder="说服你的狼队同伴……" rows={4} /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("wolf.propose", { targetSeatId: target, message: speech })}>提交狼刀提议 <span>→</span></button></>;
  if (game.phase === "seer_action") return <><h3>看穿一个人。</h3><p className="action-hint">查验结果只会回到你手里。</p><TargetSelect value={target} onChange={setTarget} targets={aliveTargets} placeholder="选择查验目标" /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("seer.inspect", { targetSeatId: target })}>查验身份 <span>→</span></button></>;
  if (game.phase === "day_vote") return <><h3>投出一票。</h3><p className="action-hint">你不能投给自己。平票无人出局。</p><TargetSelect value={target} onChange={setTarget} targets={aliveTargets} placeholder="选择放逐目标" /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("vote.cast", { targetSeatId: target })}>确认投票 <span>→</span></button></>;
  if (game.phase === "hunter_action") return <><h3>最后一枪。</h3><p className="action-hint">可以带走一个人，也可以放下枪。</p><TargetSelect value={target} onChange={setTarget} targets={aliveTargets} placeholder="选择开枪目标" allowEmpty emptyLabel="不开枪" /><button className="primary-button" onClick={() => void sendCommand("hunter.shoot", { targetSeatId: target || null })}>扣下扳机 <span>→</span></button></>;
  return <div className="waiting-state"><span className="waiting-orb" /><h3>夜色正在移动。</h3><p>请稍候。</p></div>;
}

function TargetSelect({ value, onChange, targets, placeholder, allowEmpty = false, emptyLabel = "" }: { value: string; onChange: (value: string) => void; targets: PublicState["players"]; placeholder: string; allowEmpty?: boolean; emptyLabel?: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={placeholder}><option value="">{allowEmpty ? emptyLabel : placeholder}</option>{targets.map((player) => <option key={player.seatId} value={player.seatId}>{player.name} · {player.seatId}</option>)}</select>;
}

function TimelineEvent({ event, game }: { event: GameEvent; game: PublicState }) {
  if (event.type === "speech.completed") return <div className="timeline-item speech-item"><span className="timeline-time">#{event.seq.toString().padStart(2, "0")}</span><div><strong>{playerName(game, String(event.payload.seatId))}</strong><p>{String(event.payload.text)}</p></div></div>;
  if (event.type === "phase.changed") return <div className="timeline-divider"><span>{String(event.payload.label)}</span><i /></div>;
  if (event.type === "vote.cast") return <div className="timeline-item compact-item"><span className="event-glyph">↗</span><p><strong>{playerName(game, String(event.payload.from))}</strong> 将票投给了 <strong>{playerName(game, String(event.payload.target))}</strong></p></div>;
  if (event.type === "player.eliminated") return <div className="timeline-item elimination-item"><span className="event-glyph">×</span><p>{event.payload.seatId ? <><strong>{playerName(game, String(event.payload.seatId))}</strong> 离开了牌桌。</> : String(event.payload.message)}</p></div>;
  if (event.type === "seer.result") return <div className="timeline-item private-item"><span className="event-glyph">◉</span><p>查验结果：<strong>{playerName(game, String(event.payload.targetSeatId))}</strong> 属于<strong>{event.payload.faction === "werewolf" ? "狼人" : "好人"}</strong>。</p></div>;
  if (event.type === "wolf.proposal") return <div className="timeline-item private-item"><span className="event-glyph">♠</span><p>狼队密谈：{event.payload.message ? String(event.payload.message) : `目标锁定为 ${playerName(game, String(event.payload.resolvedTargetSeatId))}`}</p></div>;
  if (event.type === "hunter.prompt") return <div className="timeline-item warning-item"><span className="event-glyph">!</span><p>猎人倒下前，还有最后一次选择。</p></div>;
  if (event.type === "game.over") return <div className="timeline-item result-item"><span className="event-glyph">✦</span><p>本局结束：{event.payload.winner === "village" ? "好人阵营胜利" : "狼人阵营胜利"}。</p></div>;
  if (event.type === "agent.error") return <div className="timeline-item warning-item"><span className="event-glyph">!</span><p>一名 AI 暂时失去回应，已使用安全替补。</p></div>;
  return null;
}

function GameOver({ winner, onRestart, loading }: { winner?: PublicState["winner"]; onRestart: () => void; loading: boolean }) {
  return <div className="game-over"><span className="result-star">✦</span><h3>{winner === "village" ? "村庄醒来了" : "狼群接管了夜色"}</h3><p>{winner === "village" ? "你们找到了所有伪装者。" : "最后的票型已经无法挽回。"}</p><button className="secondary-button" disabled={loading} onClick={onRestart}>再开一局 <span>↻</span></button></div>;
}

function collectStreaming(events: GameEvent[]): Map<string, string> {
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

function roleGlyph(role: Role): string {
  return { werewolf: "☾", seer: "◉", witch: "✣", hunter: "⌁", villager: "○" }[role];
}
