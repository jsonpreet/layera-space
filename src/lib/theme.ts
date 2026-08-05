/**
 * Shared visual constants for the surfaces that can't read CSS custom
 * properties: xterm, Monaco and the replay player each take a JS theme object.
 * These stacks used to be duplicated verbatim in three components.
 */

export const UI_STACK =
  'ui-sans-serif, system-ui, "SF Pro Text", "Segoe UI", sans-serif';

export const MONO_STACK =
  'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace';

/** Mirrors the `@theme` block in index.css. */
export const PALETTE = {
  base: "#16130f",
  panel: "#1d1915",
  raised: "#262119",
  hover: "#2e2820",
  ink: "#ece5da",
  muted: "#94897a",
  faint: "#6b6156",
  line: "#332c23",
  accent: "#c98f52",
  accentDeep: "#a06b38",
  ok: "#7fae72",
  warn: "#d3a24b",
  danger: "#d47a5c",
} as const;

export const TERM_THEME = {
  background: PALETTE.base,
  foreground: PALETTE.ink,
  cursor: PALETTE.accent,
  cursorAccent: PALETTE.base,
  selectionBackground: "#3a3226",
  black: PALETTE.panel,
  red: PALETTE.danger,
  green: PALETTE.ok,
  yellow: PALETTE.warn,
  blue: "#6f9bb5",
  magenta: "#b58bb0",
  cyan: "#6fb0a8",
  white: PALETTE.ink,
  brightBlack: PALETTE.faint,
  brightRed: "#e29179",
  brightGreen: "#96c18a",
  brightYellow: "#e0b668",
  brightBlue: "#88b0c7",
  brightMagenta: "#c7a3c2",
  brightCyan: "#87c2ba",
  brightWhite: "#f5efe6",
} as const;

export const TERM_OPTIONS = {
  fontFamily: MONO_STACK,
  fontSize: 13,
  lineHeight: 1.25,
  allowProposedApi: true,
} as const;
