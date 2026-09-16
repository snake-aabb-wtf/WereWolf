import { Navigate, Route, Routes } from "react-router-dom";
import { GamePage } from "./GamePage";
import { MainMenuPage } from "./MainMenuPage";
import { ReplayPage } from "./ReplayPage";
import { TrashPage } from "./TrashPage";

export function AppShell({ libraryToken, renewLibraryToken }: { libraryToken: string; renewLibraryToken: () => Promise<string> }) {
  return <Routes>
    <Route path="/" element={<MainMenuPage libraryToken={libraryToken} renewLibraryToken={renewLibraryToken} />} />
    <Route path="/game/:gameId" element={<GamePage libraryToken={libraryToken} />} />
    <Route path="/replay/:gameId" element={<ReplayPage libraryToken={libraryToken} />} />
    <Route path="/trash" element={<TrashPage libraryToken={libraryToken} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
