import type { RunMode } from "./run";

/**
 * Mode preambles.
 *
 * Deliberately short. These CLIs already have their own system prompts and
 * project instructions; the preamble only states the shape of the answer this
 * surface expects, and never re-explains the agent's job to it.
 */
const PREAMBLE: Partial<Record<RunMode, string>> = {
  chat: [
    "Answer the question directly and concisely.",
    "Do not modify files — this is a read-only question.",
  ].join(" "),

  plan: [
    "Produce an implementation plan. Do not write any code or modify files.",
    "",
    "Format the plan as a markdown list of steps under a `## Steps` heading,",
    "one step per line, each starting with `- `. Keep each step to a single",
    "sentence naming the concrete change and the file it affects.",
  ].join("\n"),

  build: [
    "Implement the request in this repository.",
    "Make the change directly, then briefly state what you changed and why.",
  ].join(" "),
};

export function buildPrompt(mode: RunMode, input: string): string {
  const preamble = PREAMBLE[mode];
  return preamble ? `${preamble}\n\n---\n\n${input}` : input;
}

export type PlanStep = { text: string };

/**
 * Pull steps out of a plan response.
 *
 * Lenient on purpose: models drift between `## Steps`, `## Plan`, numbered
 * lists and bare bullets, and a plan that fails to parse is worse than one
 * parsed slightly too generously.
 */
export function parsePlan(text: string): PlanStep[] {
  const lines = text.split("\n");
  const steps: PlanStep[] = [];

  // Prefer the section under a Steps/Plan heading when there is one.
  let start = 0;
  let end = lines.length;
  const headingAt = lines.findIndex((l) =>
    /^#{1,6}\s*(steps|plan|implementation)\b/i.test(l.trim()),
  );
  if (headingAt >= 0) {
    start = headingAt + 1;
    const nextHeading = lines
      .slice(start)
      .findIndex((l) => /^#{1,6}\s/.test(l.trim()));
    if (nextHeading >= 0) end = start + nextHeading;
  }

  for (const raw of lines.slice(start, end)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    const body = bullet?.[1] ?? numbered?.[1];
    if (!body) continue;
    // Strip a leading checkbox so a re-parsed plan doesn't accumulate them.
    const text = body.replace(/^\[[ xX]\]\s*/, "").trim();
    if (text) steps.push({ text });
  }
  return steps;
}

/** A short, human title for a thread or task derived from the first line. */
export function titleFrom(input: string, max = 60): string {
  const line = input.trim().split("\n")[0]?.trim() ?? "";
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}
