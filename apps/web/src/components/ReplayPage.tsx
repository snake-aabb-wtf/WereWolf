import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ReplayState } from "@werewolf/domain";
import { saveApi } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConversationTimeline } from "./ConversationTimeline";
import { deathCauseNames, formatTimestamp, roleGlyph, roleNames } from "./game-data";

export function ReplayPage({ libraryToken }: { libraryToken: string }) {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void saveApi.replay(libraryToken, gameId).then(setReplay).catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : "无法加载复盘"));
  }, [gameId, libraryToken]);

  const deleteReplay = async () => {
    try {
      await saveApi.remove(libraryToken, gameId);
      navigate("/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除复盘失败");
      setConfirmDelete(false);
    }
  };

  if (!replay) return <main className="center-page"><div className="waiting-state"><span className="waiting-orb" /><h3>{error ? "复盘没有回应。" : "正在摊开这局牌。"}</h3><p>{error || "隐藏身份和每一次选择都会被还原。"}</p><Link className="secondary-button inline-button" to="/">返回存档库 <span>←</span></Link></div></main>;

  return <main className="replay-shell"><header className="replay-topbar"><Link className="back-link" to="/">← 存档库</Link><div className="brand-lockup"><span className="brand-mark">✦</span><span>暗桌 / REPLAY</span></div><button className="text-button danger-text" onClick={() => setConfirmDelete(true)}>删除存档</button></header>{error && <div className="error-banner" role="alert">{error}</div>}<section className="replay-heading"><p className="eyebrow">COMPLETE IDENTITY REPLAY</p><h1>{replay.name}</h1><p>第 {replay.round} 夜结束 · {replay.winner === "village" ? "好人阵营胜利" : "狼人阵营胜利"}</p></section><section className="replay-layout"><div className="replay-record"><div className="panel-heading"><div><p className="eyebrow">FULL EVENT LOG</p><h2>完整记录</h2></div><span className="record-count">{replay.events.length.toString().padStart(2, "0")} EVENTS</span></div><ConversationTimeline events={replay.events} players={replay.players} full /></div><aside className="replay-roster"><div className="panel-heading"><div><p className="eyebrow">IDENTITIES REVEALED</p><h2>身份摊牌</h2></div></div><div className="replay-player-list">{replay.players.map((player) => <article className={`replay-player ${player.status === "dead" ? "is-dead" : ""}`} key={player.seatId}><span className={`replay-glyph role-${player.role}`}>{roleGlyph(player.role)}</span><div><strong>{player.name}</strong><p>{roleNames[player.role]} · {player.faction === "werewolf" ? "狼人阵营" : "好人阵营"}</p></div><small>{player.status === "dead" ? `${player.deathRound ? `第 ${player.deathRound} 轮 · ` : ""}${player.deathCause ? deathCauseNames[player.deathCause] : ""} 出局` : "存活"}</small></article>)}</div></aside></section><p className="replay-footnote">复盘生成于 {formatTimestamp(Date.now())} · 这是只读记录，不会影响牌局。</p><ConfirmDialog open={confirmDelete} title="删除这局复盘？" description="存档会先进入回收站，之后仍可恢复。" confirmLabel="移入回收站" destructive onConfirm={() => void deleteReplay()} onCancel={() => setConfirmDelete(false)} /></main>;
}
