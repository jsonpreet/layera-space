import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceView } from "./components/WorkspaceView";
import { Rail } from "./components/rail/Rail";
import { initAlerts } from "./lib/alerts";
import { useApp } from "./store/app";
import "./index.css";

function App() {
  const { ready, workspaces, activeWorkspaceId, init, initRuns } = useApp();

  useEffect(() => {
    void init();
    void initRuns();
    initAlerts();
  }, [init, initRuns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        const s = useApp.getState();
        const wsId = s.activeWorkspaceId;
        if (!wsId) return;
        const paneId = s.focused[wsId];
        if (!paneId) return;
        e.preventDefault();
        s.closePane(paneId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return (
      <main className="flex h-full items-center justify-center bg-base text-sm text-faint">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex h-full bg-base">
      <Sidebar />
      <div className="min-w-0 flex-1">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={ws.id === activeWorkspaceId ? "h-full" : "hidden"}
          >
            <WorkspaceView ws={ws} />
          </div>
        ))}
      </div>
      {/*
        A sibling of the workspace container, not a child of it: the thread then
        survives workspace switches, and the browser pane's child webview keeps
        getting correct window-coordinate rects as the row resizes.
      */}
      <Rail />
    </main>
  );
}

export default App;
