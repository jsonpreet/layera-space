export type SoundKind = "chime" | "pluck" | "bell";

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  peak: number,
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playSound(kind: SoundKind) {
  const c = ac();
  if (!c) return;
  try {
    switch (kind) {
      case "chime":
        tone(c, 523.25, 0, 0.5, "sine", 0.16);
        tone(c, 659.25, 0.12, 0.6, "sine", 0.14);
        tone(c, 783.99, 0.24, 0.85, "sine", 0.12);
        break;
      case "pluck":
        tone(c, 440, 0, 0.18, "triangle", 0.22);
        tone(c, 587.33, 0.09, 0.24, "triangle", 0.18);
        break;
      case "bell":
        tone(c, 880, 0, 1.1, "sine", 0.15);
        tone(c, 1760, 0, 0.45, "sine", 0.05);
        break;
    }
  } catch {
    // audio unavailable
  }
}
