import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { playSound } from "./sound";
import { RUNNER_LABEL } from "./run";
import {
  setDoneHandler,
  setRunDoneHandler,
  useApp,
  type DoneSource,
  type Pane,
} from "../store/app";

let permissionAsked = false;

async function ensurePermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    if (!permissionAsked) {
      permissionAsked = true;
      return (await requestPermission()) === "granted";
    }
    return false;
  } catch {
    return false;
  }
}

function sourceLabel(source: DoneSource): string {
  if (source === "idle") return "appears idle";
  return "task completed";
}

function paneVisible(pane: Pane): boolean {
  const s = useApp.getState();
  if (!document.hasFocus()) return false;
  if (s.activeWorkspaceId !== pane.workspaceId) return false;
  const z = s.zoomed[pane.workspaceId];
  if (z && z !== pane.id) return false;
  return true;
}

export function initAlerts() {
  setDoneHandler((pane, source) => {
    const s = useApp.getState();
    const ws = s.workspaces.find((w) => w.id === pane.workspaceId);
    const visible = paneVisible(pane);

    if (!visible && s.settings.sound !== "muted" && !ws?.muted) {
      playSound(s.settings.sound);
    }

    if (!visible && s.settings.notifyEnabled) {
      void ensurePermission().then((ok) => {
        if (!ok) return;
        sendNotification({
          title: `${pane.title} finished`,
          body: ws ? `${ws.title} · ${sourceLabel(source)}` : sourceLabel(source),
        });
      });
    }
  });

  // Headless runs alert on the same terms as interactive panes: only when the
  // user isn't already looking at the workspace they belong to.
  setRunDoneHandler((record) => {
    const s = useApp.getState();
    const ws = s.workspaces.find((w) => w.id === record.workspaceId);
    const looking =
      document.hasFocus() && s.activeWorkspaceId === record.workspaceId;
    if (looking) return;

    if (s.settings.sound !== "muted" && !ws?.muted) playSound(s.settings.sound);

    if (s.settings.notifyEnabled) {
      const outcome =
        record.status === "ok"
          ? "finished"
          : record.status === "cancelled"
            ? "was stopped"
            : record.status;
      const files = record.filesChanged.length;
      void ensurePermission().then((ok) => {
        if (!ok) return;
        sendNotification({
          title: `${record.label || RUNNER_LABEL[record.runner]} ${outcome}`,
          body: [
            ws?.title,
            files > 0 ? `${files} file${files === 1 ? "" : "s"} changed` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      });
    }
  });
}
