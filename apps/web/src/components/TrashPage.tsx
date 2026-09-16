import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SaveSummary } from "@werewolf/domain";
import { libraryApi, saveApi } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { SaveCard } from "./SaveCard";

export function TrashPage({ libraryToken }: { libraryToken: string }) {
  const navigate = useNavigate();
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<SaveSummary | null>(null);

  const load = useCallback(async () => {
    try { setSaves(await libraryApi.listSaves(libraryToken, true)); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "无法读取回收站"); }
  }, [libraryToken]);
  useEffect(() => { void load(); }, [load]);

  const restore = async (save: SaveSummary) => {
    try { await saveApi.restore(libraryToken, save.gameId); setSaves((current) => current.filter((candidate) => candidate.gameId !== save.gameId)); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "恢复失败"); }
  };
  const permanentlyDelete = async () => {
    if (!pending) return;
    try { await saveApi.permanentlyDelete(libraryToken, pending.gameId); setSaves((current) => current.filter((candidate) => candidate.gameId !== pending.gameId)); setPending(null); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "永久删除失败"); }
  };

  return <main className="menu-shell trash-shell"><header className="menu-topbar"><Link className="back-link" to="/">← 存档库</Link><div className="brand-lockup"><span className="brand-mark">✦</span><span>暗桌 / TRASH</span></div><span className="menu-session">RECOVERABLE ARCHIVE</span></header><section className="trash-heading"><p className="eyebrow">RECYCLE BIN</p><h1>被放下的牌。</h1><p>这里的存档还没有消失。恢复它们，牌桌会继续记得。</p></section>{error && <div className="error-banner" role="alert">{error}</div>}{saves.length > 0 ? <div className="save-grid">{saves.map((save) => <SaveCard key={save.gameId} save={save} trash onRename={async () => undefined} onRestore={(item) => void restore(item)} onPermanentDelete={setPending} />)}</div> : <div className="menu-empty"><span className="empty-mark">✦</span><h2>回收站是空的。</h2><p>被删除的存档会在这里等待。</p><button className="secondary-button inline-button" onClick={() => navigate("/")}>返回存档库 <span>←</span></button></div>}<ConfirmDialog open={Boolean(pending)} title="永久删除这局？" description="快照、事件和 AI 回合记录都会被彻底清理，无法恢复。" confirmLabel="永久删除" destructive onConfirm={() => void permanentlyDelete()} onCancel={() => setPending(null)} /></main>;
}
