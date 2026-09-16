import type { PublicState } from "@werewolf/domain";

type WitchChoice = "none" | "save" | "poison";

export function ActionPanel({ game, canAct, target, setTarget, speech, setSpeech, witchChoice, setWitchChoice, sendCommand }: {
  game: PublicState;
  canAct: boolean;
  target: string;
  setTarget: (value: string) => void;
  speech: string;
  setSpeech: (value: string) => void;
  witchChoice: WitchChoice;
  setWitchChoice: (value: WitchChoice) => void;
  sendCommand: (type: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  if (!canAct) return <div className="waiting-state"><span className="waiting-orb" /><h3>听着。</h3><p>AI 正在整理它们的发言，<br />轮到你时这里会亮起来。</p></div>;
  const targets = game.players.filter((player) => player.status === "alive" && (game.phase === "guard_action" || player.seatId !== game.human.seatId) && !game.human.wolfMates?.includes(player.seatId));
  if (game.phase === "day_speech") return <><h3>轮到你说话。</h3><p className="action-hint">把怀疑留在桌面上。最多 800 字。</p><textarea value={speech} onChange={(event) => setSpeech(event.target.value)} placeholder="我注意到……" rows={6} /><button className="primary-button" disabled={!speech.trim()} onClick={() => void sendCommand("speech.submit", { text: speech })}>留下发言 <span>→</span></button></>;
  if (game.phase === "witch_action") return <><h3>夜色给你一瓶药。</h3><p className="action-hint">每夜最多使用一种。解药不能救自己。</p><div className="choice-list"><label className={witchChoice === "none" ? "selected" : ""}><input type="radio" checked={witchChoice === "none"} onChange={() => setWitchChoice("none")} />不使用</label><label className={witchChoice === "save" ? "selected" : ""}><input type="radio" checked={witchChoice === "save"} onChange={() => setWitchChoice("save")} />使用解药</label><label className={witchChoice === "poison" ? "selected" : ""}><input type="radio" checked={witchChoice === "poison"} onChange={() => setWitchChoice("poison")} />使用毒药</label></div>{witchChoice === "poison" && <TargetSelect value={target} onChange={setTarget} targets={targets} placeholder="选择毒药目标" />}{witchChoice === "save" && <div className="notice-strip">若今晚有人被狼袭击，你会尝试救下他。</div>}<button className="primary-button" disabled={witchChoice === "poison" && !target} onClick={() => void sendCommand("witch.resolve", { save: witchChoice === "save", poisonTargetSeatId: witchChoice === "poison" ? target : null })}>确认夜间决策 <span>→</span></button></>;
  if (game.phase === "wolf_discussion") return <><h3>狼队密谈。</h3><p className="action-hint">你的提议只会被狼队看见。</p><TargetSelect value={target} onChange={setTarget} targets={targets} placeholder="选择今晚的目标" /><textarea value={speech} onChange={(event) => setSpeech(event.target.value)} placeholder="说服你的狼队同伴……" rows={4} /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("wolf.propose", { targetSeatId: target, message: speech })}>提交狼刀提议 <span>→</span></button></>;
  if (game.phase === "guard_action") return <><h3>守住一个人。</h3><p className="action-hint">今晚的守护只会抵消狼刀，可以守护自己。</p><TargetSelect value={target} onChange={setTarget} targets={targets} placeholder="选择守护目标" /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("guard.protect", { targetSeatId: target })}>确认守护 <span>→</span></button></>;
  if (game.phase === "seer_action") return <><h3>看穿一个人。</h3><p className="action-hint">查验结果只会回到你手里。</p><TargetSelect value={target} onChange={setTarget} targets={targets} placeholder="选择查验目标" /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("seer.inspect", { targetSeatId: target })}>查验身份 <span>→</span></button></>;
  if (game.phase === "day_vote") return <><h3>投出一票。</h3><p className="action-hint">你不能投给自己。平票无人出局。</p><TargetSelect value={target} onChange={setTarget} targets={targets} placeholder="选择放逐目标" /><button className="primary-button" disabled={!target} onClick={() => void sendCommand("vote.cast", { targetSeatId: target })}>确认投票 <span>→</span></button></>;
  if (game.phase === "hunter_action") return <><h3>最后一枪。</h3><p className="action-hint">可以带走一个人，也可以放下枪。</p><TargetSelect value={target} onChange={setTarget} targets={targets} placeholder="选择开枪目标" allowEmpty emptyLabel="不开枪" /><button className="primary-button" onClick={() => void sendCommand("hunter.shoot", { targetSeatId: target || null })}>扣下扳机 <span>→</span></button></>;
  return <div className="waiting-state"><span className="waiting-orb" /><h3>夜色正在移动。</h3><p>请稍候。</p></div>;
}

function TargetSelect({ value, onChange, targets, placeholder, allowEmpty = false, emptyLabel = "" }: { value: string; onChange: (value: string) => void; targets: PublicState["players"]; placeholder: string; allowEmpty?: boolean; emptyLabel?: string }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={placeholder}><option value="">{allowEmpty ? emptyLabel : placeholder}</option>{targets.map((player) => <option key={player.seatId} value={player.seatId}>{player.name} · {player.seatId}</option>)}</select>;
}
