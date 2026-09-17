import { useEffect, useState } from "react";
import type { PublicState } from "@werewolf/domain";
import { roleGlyph, roleNames } from "./game-data";

type RevealStage = "drawing" | "turning" | "revealed";

export function IdentityReveal({ game, onComplete }: { game: PublicState; onComplete: () => void }) {
  const [stage, setStage] = useState<RevealStage>("drawing");
  const humanName = game.players.find((player) => player.seatId === game.human.seatId)?.name ?? "你";
  const isWerewolf = game.human.faction === "werewolf";

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onComplete();
    };
    const turnDelay = reducedMotion ? 280 : 1_000;
    const revealDelay = reducedMotion ? 900 : 2_350;
    const finishDelay = reducedMotion ? 2_200 : 4_800;
    const timers = [
      window.setTimeout(() => setStage("turning"), turnDelay),
      window.setTimeout(() => setStage("revealed"), revealDelay),
      window.setTimeout(onComplete, finishDelay)
    ];
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onComplete]);

  return <main className="identity-reveal-shell" aria-label="身份揭示">
    <header className="reveal-topbar">
      <div className="brand-lockup"><span className="brand-mark">✦</span><span>暗桌 / WEREWOLF</span></div>
      <button className="reveal-skip-button" onClick={onComplete}>跳过揭示 <span>ESC</span></button>
    </header>
    <div className="reveal-layout">
      <section className="reveal-copy">
        <p className="eyebrow">ROLE DRAW / SEAT 01</p>
        <h1>你的身份，<br /><em>现在揭晓。</em></h1>
        <p className="reveal-description">十二张牌已经洗匀。今晚，你会以什么身份坐在这张桌边？</p>
        <div className="reveal-progress" aria-live="polite">
          <span className={`progress-step ${stage === "drawing" ? "is-active" : "is-done"}`}>01 <b>洗牌</b></span>
          <i />
          <span className={`progress-step ${stage === "drawing" ? "" : stage === "turning" ? "is-active" : "is-done"}`}>02 <b>抽取</b></span>
          <i />
          <span className={`progress-step ${stage === "revealed" ? "is-active" : ""}`}>03 <b>确认</b></span>
        </div>
      </section>
      <section className="identity-draw-stage" aria-live="polite">
        <div className="draw-sigil draw-sigil-left">✧</div>
        <div className="draw-sigil draw-sigil-right">·</div>
        <div className="shuffle-deck" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className={`identity-card-scene is-${stage}`}>
          <div className="identity-card-inner">
            <div className="identity-card-face identity-card-back">
              <span className="card-corner top-left">✦</span>
              <span className="card-corner bottom-right">✦</span>
              <div className="card-back-mark"><span>✦</span><i /></div>
              <p>THE NIGHT TABLE</p>
              <small>身份牌 · 请勿展示</small>
            </div>
            <div className="identity-card-face identity-card-front">
              <div className="card-front-header"><span>YOUR ROLE</span><span>12 / 12</span></div>
              <div className="card-front-center">
                <span className="role-reveal-glyph">{roleGlyph(game.human.role)}</span>
                <p>{humanName}</p>
                <h2>{roleNames[game.human.role]}</h2>
                <span className={`faction-ribbon ${isWerewolf ? "is-werewolf" : ""}`}>{isWerewolf ? "WEREWOLF FACTION" : "VILLAGE FACTION"}</span>
              </div>
              <p className="role-reveal-note">{game.human.personality}</p>
              <div className="card-front-footer"><span>SEAT {game.human.seatId.replace("seat-", "").padStart(2, "0")}</span><span>暗桌已记录</span></div>
            </div>
          </div>
        </div>
        <div className="draw-caption"><span className="live-dot">●</span>{stage === "revealed" ? "身份已确认，牌桌正在唤醒" : stage === "turning" ? "正在翻开你的身份牌" : "正在从暗桌中抽取"}</div>
      </section>
    </div>
    <footer className="reveal-footer"><span className="footnote-rule" />这是你的秘密。<br />游戏开始后，只有你能看见它。</footer>
  </main>;
}
