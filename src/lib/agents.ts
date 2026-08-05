export type AgentKind = "claude" | "codex" | "opencode";

export type AgentMeta = {
  name: string;
  cmd: string;
  install: string;
};

export const AGENTS: Record<AgentKind, AgentMeta> = {
  claude: {
    name: "Claude Code",
    cmd: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
  },
  codex: {
    name: "Codex",
    cmd: "codex",
    install: "npm install -g @openai/codex",
  },
  opencode: {
    name: "OpenCode",
    cmd: "opencode",
    install: "curl -fsSL https://opencode.ai/install | bash",
  },
};

export const AGENT_ORDER: AgentKind[] = ["claude", "codex", "opencode"];

export const AGENT_TINT: Record<AgentKind, string> = {
  claude: "#d47a5c",
  codex: "#7fae72",
  opencode: "#6f9bb5",
};
