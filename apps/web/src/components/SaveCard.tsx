import { useEffect, useState } from "react";
import type { SaveSummary } from "@werewolf/domain";
import { formatTimestamp, phaseNames } from "./game-data";

export function SaveCard({ save, trash = false, onOpen, onReplay, onRename, onDelete, onRestore, onPermanentDelete }: {
  save: SaveSummary;
  trash?: boolean;
  onOpen?: (save: SaveSummary) => void;
  onReplay?: (save: SaveSummary) => void;
  onRename: (save: SaveSummary, name: string) => Promise<void>;
  onDelete?: (save: SaveSummary) => void;
  onRestore?: (save: SaveSummary) => void;
  onPermanentDelete?: (save: SaveSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(save.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setName(save.name), [save.name]);

  const submitName = async () => {
    setSaving(true);
    setError("");
    try {
      await onRename(save, name);
      setEditing(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重命名失败");
    } finally {
      setSaving(false);
    }
  };

  return <article className={`save-card ${trash ? "is-trash" : ""}`}>
    <div className="save-card-top"><span className={`save-status ${save.status}`}>{save.status === "completed" ? "已结束" : "进行中"}</span><span className="save-date">{formatTimestamp(save.updatedAt)}</span></div>
    {editing ? <div className="save-name-edit"><input value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} aria-label="存档名称" /><div><button className="text-button" disabled={saving} onClick={() => { setName(save.name); setEditing(false); }}>取消</button><button className="text-button accent" disabled={saving || !name.trim()} onClick={() => void submitName()}>保存</button></div></div> : <div className="save-title-row"><h3>{save.name}</h3>{!trash && <button className="icon-button" aria-label="重命名存档" onClick={() => setEditing(true)}>✎</button>}</div>}
    {error && <p className="error-copy" role="alert">{error}</p>}
    <div className="save-meta"><span>第 {save.round} 夜</span><span>{phaseNames[save.phase]}</span><span>{save.aliveCount}/{save.playerCount} 存活</span></div>
    {save.winner && <p className={`save-result ${save.winner}`}>{save.winner === "village" ? "好人阵营胜利" : "狼人阵营胜利"}</p>}
    <div className="save-actions">
      {!trash && save.status === "in_progress" && onOpen && <button className="primary-button compact-button" onClick={() => onOpen(save)}>继续 <span>→</span></button>}
      {!trash && save.status === "completed" && onReplay && <button className="primary-button compact-button" onClick={() => onReplay(save)}>查看复盘 <span>→</span></button>}
      {trash && onRestore && <button className="primary-button compact-button" onClick={() => onRestore(save)}>恢复 <span>↗</span></button>}
      {!trash && onDelete && <button className="text-button danger-text" onClick={() => onDelete(save)}>删除</button>}
      {trash && onPermanentDelete && <button className="text-button danger-text" onClick={() => onPermanentDelete(save)}>永久删除</button>}
    </div>
  </article>;
}
