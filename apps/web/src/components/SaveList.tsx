import type { SaveSummary } from "@werewolf/domain";
import { SaveCard } from "./SaveCard";

export function SaveList({ title, eyebrow, saves, empty, onOpen, onReplay, onRename, onDelete }: {
  title: string;
  eyebrow: string;
  saves: SaveSummary[];
  empty: string;
  onOpen?: (save: SaveSummary) => void;
  onReplay?: (save: SaveSummary) => void;
  onRename: (save: SaveSummary, name: string) => Promise<void>;
  onDelete: (save: SaveSummary) => void;
}) {
  return <section className="save-section"><div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span>{saves.length.toString().padStart(2, "0")}</span></div>{saves.length > 0 ? <div className="save-grid">{saves.map((save) => <SaveCard key={save.gameId} save={save} {...(onOpen ? { onOpen } : {})} {...(onReplay ? { onReplay } : {})} onRename={onRename} onDelete={onDelete} />)}</div> : <p className="save-empty">{empty}</p>}</section>;
}
