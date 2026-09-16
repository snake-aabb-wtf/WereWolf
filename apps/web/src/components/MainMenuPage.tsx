import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SaveSummary } from "@werewolf/domain";
import { ApiError, gameApi, libraryApi, saveApi } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { SaveList } from "./SaveList";

export function MainMenuPage({ libraryToken, renewLibraryToken }: { libraryToken: string; renewLibraryToken: () => Promise<string> }) {
  const navigate = useNavigate();
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SaveSummary | null>(null);

  const loadSaves = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSaves(await libraryApi.listSaves(libraryToken));
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        try {
          const nextToken = await renewLibraryToken();
          setSaves(await libraryApi.listSaves(nextToken));
        } catch (renewError) {
          setError(renewError instanceof Error ? renewError.message : "无法加载存档");
        }
      } else {
        setError(requestError instanceof Error ? requestError.message : "无法加载存档");
      }
    } finally {
      setLoading(false);
    }
  }, [libraryToken, renewLibraryToken]);

  useEffect(() => { void loadSaves(); }, [loadSaves]);

  const activeSaves = useMemo(() => saves.filter((save) => save.status === "in_progress"), [saves]);
  const completedSaves = useMemo(() => saves.filter((save) => save.status === "completed"), [saves]);
  const latest = activeSaves[0];

  const startGame = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await gameApi.create(libraryToken);
      navigate(`/game/${created.gameId}`, { state: { playerToken: created.playerToken } });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建游戏失败");
    } finally {
      setBusy(false);
    }
  };

  const continueGame = async (save: SaveSummary) => {
    setBusy(true);
    setError("");
    try {
      const resumed = await saveApi.resume(libraryToken, save.gameId);
      navigate(`/game/${save.gameId}`, { state: { playerToken: resumed.playerToken } });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法继续这局游戏");
    } finally {
      setBusy(false);
    }
  };

  const rename = async (save: SaveSummary, name: string) => {
    const updated = await saveApi.rename(libraryToken, save.gameId, name);
    setSaves((current) => current.map((candidate) => candidate.gameId === updated.gameId ? updated : candidate));
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await saveApi.remove(libraryToken, pendingDelete.gameId);
      setSaves((current) => current.filter((save) => save.gameId !== pendingDelete.gameId));
      setPendingDelete(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除存档失败");
    } finally {
      setBusy(false);
    }
  };

  return <main className="menu-shell">
    <header className="menu-topbar"><div className="brand-lockup"><span className="brand-mark">✦</span><span>暗桌 / WEREWOLF</span></div><nav className="menu-nav"><span className="menu-session">ANONYMOUS TABLE</span><Link to="/trash" className="text-button">回收站</Link></nav></header>
    <section className="menu-hero"><div className="menu-hero-copy"><p className="eyebrow">A PRIVATE TABLE FOR TWELVE</p><h1>每一句话<br /><em>都有立场。</em></h1><p>十二个座位，一张暗桌。每一局都被记住，每一个选择都会留下痕迹。</p><button className="primary-button menu-start-button" disabled={busy} onClick={() => void startGame()}>{busy ? "正在点亮牌桌…" : "新开一局"}<span>→</span></button></div><div className="continue-card"><div className="card-kicker">CONTINUE RECENTLY</div>{latest ? <><div className="continue-orbit"><span>◌</span><small>IN PROGRESS</small></div><h2>{latest.name}</h2><p>第 {latest.round} 夜 · {latest.aliveCount}/{latest.playerCount} 存活</p><button className="secondary-button" disabled={busy} onClick={() => void continueGame(latest)}>继续最近一局 <span>→</span></button></> : <><div className="continue-orbit is-empty"><span>✦</span><small>NO ACTIVE TABLE</small></div><h2>暗桌还空着。</h2><p>新开一局，事件会自动保存在这里。</p><button className="secondary-button" disabled={busy} onClick={() => void startGame()}>开始第一局 <span>→</span></button></>}</div></section>
    <div className="menu-toolbar"><div><p className="eyebrow">TABLE ARCHIVE</p><h2>你的存档库</h2></div><span>{activeSaves.length + completedSaves.length} 局记录</span></div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {loading ? <div className="menu-empty"><span className="waiting-orb" /><p>正在翻阅存档。</p></div> : <><SaveList title="进行中的牌局" eyebrow="IN PROGRESS" saves={activeSaves} empty="没有未结束的牌局。" onOpen={(save) => void continueGame(save)} onRename={rename} onDelete={setPendingDelete} /><SaveList title="历史牌局" eyebrow="COMPLETED TABLES" saves={completedSaves} empty="结束的牌局会在这里留下复盘。" onReplay={(save) => navigate(`/replay/${save.gameId}`)} onRename={rename} onDelete={setPendingDelete} /></>}
    <footer className="menu-footer"><span className="footnote-rule" />自动保存已开启 · 服务器只保存匿名令牌的哈希<br />你可以离开牌桌，但牌桌不会忘记。</footer>
    <ConfirmDialog open={Boolean(pendingDelete)} title="把这局放进回收站？" description={pendingDelete ? `“${pendingDelete.name}”会从存档库隐藏，但你仍可在回收站恢复。` : ""} confirmLabel="移入回收站" destructive onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />
  </main>;
}
