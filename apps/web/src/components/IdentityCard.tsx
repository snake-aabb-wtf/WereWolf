import type { PublicState } from "@werewolf/domain";
import { playerName, roleGlyph, roleNames } from "./game-data";

export function IdentityCard({ game }: { game: PublicState }) {
  const human = game.human;
  return <section className="identity-card">
    <div className="card-kicker">你的身份 / PRIVATE</div>
    <div className="role-row"><span className={`role-seal role-${human.role}`}>{roleGlyph(human.role)}</span><div><span className="role-label">{human.faction === "werewolf" ? "WEREWOLF FACTION" : "VILLAGE FACTION"}</span><h2>{roleNames[human.role]}</h2></div></div>
    <p>{human.personality}</p>
    {human.wolfMates && human.wolfMates.length > 0 && <div className="mate-note">狼队同伴：{human.wolfMates.map((seatId) => playerName(game, seatId)).join("、")}</div>}
  </section>;
}
