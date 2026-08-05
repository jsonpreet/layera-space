import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { WorkspaceView } from "./components/WorkspaceView";
import { initAlerts } from "./lib/alerts";
import { useApp } from "./store/app";
import "./index.css";

function App() {
  const { ready, workspaces, activeWorkspaceId, init } = useApp();

  useEffect(() => {
    void init();
    initAlerts();
  }, [init]);

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
    </main>
  );
}

export default App;
