import type { GameEvent, PlayerState } from "@werewolf/domain";
import { playerName } from "./game-data";

type TimelinePlayer = Pick<PlayerState, "seatId" | "name">;

export function ConversationTimeline({ events, players, full = false }: { events: GameEvent[]; players: TimelinePlayer[]; full?: boolean }) {
  const visibleEvents = events.filter((event) => event.type !== "speech.delta");
  const lookup = { players };
  return <div className="timeline" aria-live="polite">
    {visibleEvents.slice(-64).map((event) => <TimelineEvent key={event.seq} event={event} players={lookup} full={full} />)}
    {visibleEvents.length === 0 && <p className="empty-copy">牌桌还没有留下记录。</p>}
  </div>;
}

function TimelineEvent({ event, players, full }: { event: GameEvent; players: { players: TimelinePlayer[] }; full: boolean }) {
  if (event.type === "speech.completed") return <div className="timeline-item speech-item"><span className="timeline-time">#{event.seq.toString().padStart(2, "0")}</span><div><strong>{playerName(players, String(event.payload.seatId))}</strong><p>{String(event.payload.text)}</p></div></div>;
  if (event.type === "phase.changed") return <div className="timeline-divider"><span>{String(event.payload.label)}</span><i /></div>;
  if (event.type === "vote.cast") return <div className="timeline-item compact-item"><span className="event-glyph">↗</span><p><strong>{playerName(players, String(event.payload.from))}</strong> 将票投给了 <strong>{playerName(players, String(event.payload.target))}</strong></p></div>;
  if (event.type === "player.eliminated") return <div className="timeline-item elimination-item"><span className="event-glyph">×</span><p>{event.payload.seatId ? <><strong>{playerName(players, String(event.payload.seatId))}</strong> 离开了牌桌。</> : String(event.payload.message)}</p></div>;
  if (event.type === "seer.result") return <div className="timeline-item private-item"><span className="event-glyph">◉</span><p>{full ? <>预言家查验 <strong>{playerName(players, String(event.payload.targetSeatId))}</strong>：{event.payload.faction === "werewolf" ? "狼人" : "好人"}。</> : <>查验结果：<strong>{playerName(players, String(event.payload.targetSeatId))}</strong> 属于<strong>{event.payload.faction === "werewolf" ? "狼人" : "好人"}</strong>。</>}</p></div>;
  if (event.type === "wolf.proposal") return <div className="timeline-item private-item"><span className="event-glyph">♠</span><p>{event.payload.message ? <>狼队提议：{String(event.payload.message)}</> : <>狼队最终目标：<strong>{playerName(players, String(event.payload.resolvedTargetSeatId))}</strong>（{String(event.payload.method ?? "已决议")}）</>}</p></div>;
  if (event.type === "guard.result") return <div className="timeline-item private-item"><span className="event-glyph">◇</span><p>守卫保护：<strong>{playerName(players, String(event.payload.targetSeatId))}</strong>。</p></div>;
  if (event.type === "witch.result") return <div className="timeline-item private-item"><span className="event-glyph">✣</span><p>{full ? `女巫${event.payload.save ? "使用了解药" : event.payload.poisonTargetSeatId ? `对 ${playerName(players, String(event.payload.poisonTargetSeatId))} 使用了毒药` : "没有使用药剂"}。` : "女巫完成了夜间决策。"}</p></div>;
  if (event.type === "hunter.prompt") return <div className="timeline-item warning-item"><span className="event-glyph">!</span><p>猎人倒下前，还有最后一次选择。</p></div>;
  if (event.type === "game.over") return <div className="timeline-item result-item"><span className="event-glyph">✦</span><p>本局结束：{event.payload.winner === "village" ? "好人阵营胜利" : "狼人阵营胜利"}。</p></div>;
  if (event.type === "agent.error") return <div className="timeline-item warning-item"><span className="event-glyph">!</span><p>一名 AI 暂时失去回应，已使用安全替补。</p></div>;
  return null;
}
