import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useLibrarySession } from "./hooks/useLibrarySession";

export default function App() {
  const library = useLibrarySession();

  if (library.loading || !library.token) {
    return <main className="center-page"><div className="waiting-state"><span className="waiting-orb" /><h3>正在准备你的暗桌。</h3><p>{library.error || "正在创建匿名浏览器会话。"}</p></div></main>;
  }

  return <BrowserRouter><AppShell libraryToken={library.token} renewLibraryToken={library.renew} /></BrowserRouter>;
}
