import { useEffect, useMemo, useState } from "react";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { Note } from "../../lib/memory";
import { PALETTE } from "../../lib/theme";

type Sim = SimulationNodeDatum & { id: string; note: Note; degree: number };
type Link = SimulationLinkDatum<Sim>;

const WIDTH = 720;
const HEIGHT = 520;

/**
 * Force-directed view of the `[[wiki-link]]` graph.
 *
 * The simulation is run to completion up front rather than animated: the layout
 * is the useful part, and a perpetually drifting graph is motion for its own
 * sake in a panel people are trying to read.
 */
export function MemoryGraph({
  notes,
  selected,
  onSelect,
}: {
  notes: Note[];
  selected: string | null;
  onSelect: (rel: string) => void;
}) {
  const [tick, setTick] = useState(0);

  const { nodes, links } = useMemo(() => {
    const bySlug = new Map<string, Note>();
    for (const note of notes) {
      bySlug.set(note.name.toLowerCase(), note);
      bySlug.set(note.title.toLowerCase(), note);
    }

    const degree = new Map<string, number>();
    const edges: { source: string; target: string }[] = [];
    for (const note of notes) {
      for (const link of note.links) {
        const target = bySlug.get(link.toLowerCase());
        if (!target || target.rel === note.rel) continue;
        edges.push({ source: note.rel, target: target.rel });
        degree.set(note.rel, (degree.get(note.rel) ?? 0) + 1);
        degree.set(target.rel, (degree.get(target.rel) ?? 0) + 1);
      }
    }

    const simNodes: Sim[] = notes.map((note, i) => ({
      id: note.rel,
      note,
      degree: degree.get(note.rel) ?? 0,
      // Seed on a ring so the layout is stable rather than random each render.
      x: WIDTH / 2 + Math.cos((i / Math.max(1, notes.length)) * Math.PI * 2) * 180,
      y: HEIGHT / 2 + Math.sin((i / Math.max(1, notes.length)) * Math.PI * 2) * 180,
    }));

    const simLinks: Link[] = edges.map((e) => ({ source: e.source, target: e.target }));
    return { nodes: simNodes, links: simLinks };
  }, [notes]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink<Sim, Link>(links)
          .id((d) => d.id)
          .distance(90)
          .strength(0.6),
      )
      .force("charge", forceManyBody().strength(-260))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .stop();

    for (let i = 0; i < 220; i += 1) simulation.tick();
    setTick((t) => t + 1);
    return () => {
      simulation.stop();
    };
  }, [nodes, links]);

  if (notes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center text-[12px] text-faint">
        No notes yet. Create one, then link notes to each other with
        <span className="mx-1 text-muted">[[double brackets]]</span>
        to see them connect here.
      </div>
    );
  }

  return (
    <svg
      key={tick}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-full w-full"
      role="img"
      aria-label="Links between notes"
    >
      <g>
        {links.map((link, i) => {
          const source = link.source as Sim;
          const target = link.target as Sim;
          if (typeof source === "string" || typeof target === "string") return null;
          return (
            <line
              key={i}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={PALETTE.line}
              strokeWidth={1}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((node) => {
          const active = node.id === selected;
          // Size carries how connected a note is; colour carries selection.
          const r = 4 + Math.min(6, node.degree * 1.4);
          return (
            <g
              key={node.id}
              transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}
              onClick={() => onSelect(node.id)}
              className="cursor-pointer"
            >
              <circle
                r={r}
                fill={active ? PALETTE.accent : PALETTE.raised}
                stroke={active ? PALETTE.accent : PALETTE.faint}
                strokeWidth={1}
              />
              <text
                x={0}
                y={r + 11}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fill={active ? PALETTE.ink : PALETTE.muted}
              >
                {node.note.title.length > 22
                  ? `${node.note.title.slice(0, 21)}…`
                  : node.note.title}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
