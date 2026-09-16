import { useCallback, useEffect, useState } from "react";
import type { GameEvent, PublicState } from "@werewolf/domain";
import { ApiError, eventTypes, gameApi, saveApi } from "../api";

export function useGameSession(gameId: string, libraryToken: string, initialPlayerToken?: string) {
  const [game, setGame] = useState<PublicState | null>(null);
  const [playerToken, setPlayerToken] = useState(initialPlayerToken ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!libraryToken) return;
    setLoading(true);
    setError("");
    if (initialPlayerToken) {
      try {
        const state = await gameApi.getState(gameId, initialPlayerToken);
        setPlayerToken(initialPlayerToken);
        setGame(state);
        setLastSavedAt(Date.now());
        setLoading(false);
        return;
      } catch {
        // The game token may belong to an older browser session. Exchange the library token below.
      }
    }
    try {
      const resumed = await saveApi.resume(libraryToken, gameId);
      setPlayerToken(resumed.playerToken);
      setGame(resumed.state);
      setLastSavedAt(Date.now());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法恢复游戏");
    } finally {
      setLoading(false);
    }
  }, [gameId, initialPlayerToken, libraryToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    if (!playerToken) return null;
    const next = await gameApi.getState(gameId, playerToken);
    setGame(next);
    setLastSavedAt(Date.now());
    return next;
  }, [gameId, playerToken]);

  useEffect(() => {
    if (!game || !playerToken) return;
    const source = new EventSource(`/api/games/${gameId}/events?token=${encodeURIComponent(playerToken)}`);
    const handleEvent = (message: Event) => {
      const event = JSON.parse((message as MessageEvent<string>).data) as GameEvent;
      setGame((current) => {
        if (!current || current.events.some((candidate) => candidate.seq === event.seq)) return current;
        return { ...current, events: [...current.events, event].sort((left, right) => left.seq - right.seq) };
      });
      setLastSavedAt(Date.now());
      if (event.type !== "speech.delta") void refresh().catch(() => undefined);
    };
    eventTypes.forEach((type) => source.addEventListener(type, handleEvent));
    source.onerror = () => setError("事件连接暂时中断，浏览器会自动重连。");
    return () => {
      eventTypes.forEach((type) => source.removeEventListener(type, handleEvent));
      source.close();
    };
  }, [game?.gameId, gameId, playerToken, refresh]);

  const sendCommand = useCallback(async (type: string, payload: Record<string, unknown>) => {
    if (!playerToken) return;
    setLoading(true);
    setError("");
    try {
      const next = await gameApi.command(gameId, playerToken, type, payload);
      setGame(next);
      setLastSavedAt(Date.now());
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setError("牌局会话已失效，请返回存档库后重新进入。");
      } else {
        setError(requestError instanceof Error ? requestError.message : "操作失败");
      }
    } finally {
      setLoading(false);
    }
  }, [gameId, playerToken]);

  return { game, playerToken, loading, error, lastSavedAt, refresh, sendCommand };
}
