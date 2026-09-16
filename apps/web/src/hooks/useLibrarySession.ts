import { useCallback, useEffect, useRef, useState } from "react";
import { libraryApi } from "../api";

const STORAGE_KEY = "werewolf.library-session.v1";

export function useLibrarySession() {
  const [token, setToken] = useState(() => window.localStorage.getItem(STORAGE_KEY) ?? "");
  const [loading, setLoading] = useState(() => !window.localStorage.getItem(STORAGE_KEY));
  const [error, setError] = useState("");
  const renewalRef = useRef<Promise<string> | null>(null);

  const renew = useCallback(async () => {
    if (renewalRef.current) return renewalRef.current;
    setLoading(true);
    setError("");
    const renewal = libraryApi.createSession().then((nextToken) => {
      window.localStorage.setItem(STORAGE_KEY, nextToken);
      setToken(nextToken);
      return nextToken;
    }).catch((requestError: unknown) => {
      const message = requestError instanceof Error ? requestError.message : "无法建立浏览器玩家会话";
      setError(message);
      throw requestError;
    }).finally(() => {
      setLoading(false);
      renewalRef.current = null;
    });
    renewalRef.current = renewal;
    return renewal;
  }, []);

  useEffect(() => {
    if (token) {
      setLoading(false);
      return;
    }
    void renew().catch(() => undefined);
  }, [renew, token]);

  return { token, loading, error, renew };
}
