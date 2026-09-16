import type { PublicState } from "@werewolf/domain";

export function GameTable({ game }: { game: PublicState }) {
  return <section className="table-panel" aria-label="玩家座位">
    <div className="table-rim"><span>THE NIGHT TABLE</span><span>12 SEATS / PRIVATE ROOM</span></div>
    <div className="player-grid">
      {game.players.map((player, index) => <article className={`player-card ${player.status === "dead" ? "is-dead" : ""} ${player.seatId === game.human.seatId ? "is-human" : ""}`} key={player.seatId}>
        <div className="player-top"><span className="seat-number">{(index + 1).toString().padStart(2, "0")}</span><span className={`status-dot ${player.status}`} /></div>
        <div className="avatar-placeholder">{player.name.slice(0, 1)}</div>
        <strong>{player.name}</strong>
        <small>{player.seatId === game.human.seatId ? "YOU" : player.kind === "ai" ? "AI PLAYER" : "PLAYER"}</small>
        {player.status === "dead" && <span className="dead-stamp">OUT</span>}
      </article>)}
    </div>
    <div className="table-center"><span className="center-sigil">✦</span><span>保持怀疑</span></div>
  </section>;
}
