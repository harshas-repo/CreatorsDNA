"use client";

import { useMemo, useState } from "react";

import type {
  ColourRole,
  TasteDnaNetworkViewModel,
  TasteEdge,
  TasteNode,
  TasteNodeKind,
} from "@/lib/contracts/viewModels";
import {
  NODE_COUNT_LIMITS,
  ROLE_SHAPE,
  nodeCountStrategy,
  provenanceStyle,
  roleColour,
} from "@/lib/design/colourRoles";
import { polarPoint } from "@/lib/utils/deterministic";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";
import { VizFrame } from "@/components/viz/VizFrame";
import { EmptyState } from "@/components/ui/States";

/**
 * A — Taste DNA network (doc 05 §10A).
 *
 * **No force simulation.** A physics layout settles wherever it settles: the same
 * data produces a different picture on every load, two creators can be compared
 * across two unrelated arrangements, and a cluster that looks meaningful may only
 * be where the simulation happened to stop. This is a deterministic layered radial
 * layout instead — ring by node kind, angle by sorted order — so the shape is a
 * function of the data and the same profile always looks the same. That is also
 * what makes the fingerprint in chart F meaningful as an identity.
 *
 * Readability is handled the way doc 05 §11 asks rather than by shrinking
 * everything: `nodeCountStrategy()` picks between drawing every node, filtering
 * by kind, collapsing into category groups, and falling back to a list. The
 * graph/list switch is always available, and a network too large to draw says so
 * instead of rendering a hairball.
 *
 * Two encodings are kept apart:
 *   - COLOUR and SHAPE come from the node's semantic role (`ROLE_SHAPE`).
 *   - LINE STYLE on an edge comes from its `relation`, and on a node outline from
 *     its provenance. Provenance never recolours a node (R14).
 *   - SIZE comes from `weight`, which the contract says drives radius and not
 *     colour, so a big node and a bright node never become the same claim.
 */

const SIZE = 680;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_MAX = 252;

/** Ring radius as a fraction of `R_MAX`, by node kind. */
const RING: Record<TasteNodeKind, number> = {
  declared_interest: 0.24,
  derived_category: 0.54,
  discovered_entity: 0.8,
  taste_tag: 1,
};

/** Ring used for collapsed category groups, between declared and the outer edge. */
const GROUP_RING = 0.62;

const KIND_LABEL: Record<TasteNodeKind, string> = {
  declared_interest: "Your interests",
  derived_category: "Categories",
  discovered_entity: "Discovered entities",
  taste_tag: "Taste tags",
};

/** Edge relation → line style. Colour carries the role; dash carries the relation. */
const RELATION_DASH: Record<TasteEdge["relation"], { dash: string | undefined; label: string }> = {
  declared: { dash: undefined, label: "Declared by you" },
  recommended: { dash: undefined, label: "Recommended from your interests" },
  co_occurs: { dash: "5 3", label: "Co-occurs (tag harvested from entities)" },
  categorised: { dash: "1 4", label: "Grouped into a category" },
};

interface Placed {
  node: TasteNode;
  x: number;
  y: number;
  angle: number;
  radius: number;
}

export function TasteDnaNetwork({ model }: { model: TasteDnaNetworkViewModel }) {
  const strategy = nodeCountStrategy(model.nodes.length);
  const tooLargeForGraph = strategy === "list";

  const [mode, setMode] = useState<"graph" | "list">(tooLargeForGraph ? "list" : "graph");
  const [grouped, setGrouped] = useState(strategy === "group" || strategy === "filter");
  const [hiddenKinds, setHiddenKinds] = useState<readonly TasteNodeKind[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>(undefined);

  const nodes = useMemo(
    () => model.nodes.filter((node) => !hiddenKinds.includes(node.kind)),
    [model.nodes, hiddenKinds],
  );
  const edges = useMemo(
    () => filterEdges(model.edges, nodes, hiddenKinds),
    [model.edges, nodes, hiddenKinds],
  );

  const layout = useMemo(() => (grouped ? groupedLayout(model, nodes) : radialLayout(nodes, edges)), [
    grouped,
    model,
    nodes,
    edges,
  ]);

  const active = selected === undefined ? undefined : layout.placed.find((p) => p.node.id === selected);
  const activeGroup =
    selectedGroup === undefined ? undefined : model.groups.find((group) => group.id === selectedGroup);

  return (
    <VizFrame
      index="A"
      title="Taste DNA"
      subtitle="What you declared, what was discovered around it, and how the two connect."
      meta={model.meta}
      legend={model.legend}
      provenances={[...new Set(model.nodes.map((node) => node.provenance))]}
      controls={
        <span className="cd-net__controls">
          <button
            type="button"
            className="cd-button cd-button--ghost cd-button--xs"
            onClick={() => setMode(mode === "graph" ? "list" : "graph")}
            // A network past the list threshold cannot be drawn legibly, so the
            // graph is not offered. Saying why beats offering a button that
            // produces a hairball.
            disabled={tooLargeForGraph}
            title={
              tooLargeForGraph
                ? `${model.nodes.length} nodes exceeds the ${NODE_COUNT_LIMITS.paginate} that can be drawn legibly`
                : undefined
            }
          >
            {mode === "graph" ? "View as list" : "View as graph"}
          </button>
          {mode === "graph" ? (
            <button
              type="button"
              className="cd-button cd-button--ghost cd-button--xs"
              onClick={() => {
                setGrouped(!grouped);
                setSelectedGroup(undefined);
              }}
              aria-pressed={grouped}
            >
              {grouped ? "Expand all" : "Group by category"}
            </button>
          ) : null}
        </span>
      }
      footnotes={
        <>
          <ul className="cd-net__key">
            {Object.entries(RELATION_DASH).map(([relation, style]) => (
              <li key={relation}>
                <svg viewBox="0 0 34 8" width="34" height="8" aria-hidden="true" focusable="false">
                  <line
                    x1="1"
                    y1="4"
                    x2="33"
                    y2="4"
                    stroke="rgb(var(--chart-axis))"
                    strokeWidth="2.5"
                    strokeDasharray={style.dash}
                  />
                </svg>
                <span>{style.label}</span>
              </li>
            ))}
            <li>
              <span className="cd-net__crossdomain" aria-hidden="true" />
              <span>
                Ringed node — surfaced by the data source&apos;s own cross-domain backfill, i.e. beyond
                the niche you declared.
              </span>
            </li>
          </ul>
          <p className="cd-viz__footnote">
            Layout is deterministic: ring by node kind, angle by sorted weight. Node size is weight
            within this network; it is not a count and not a share of an audience.
          </p>
        </>
      }
    >
      {model.nodes.length === 0 ? (
        <EmptyState
          title="Nothing to connect"
          message="No nodes were produced, so there is no network to draw."
          hint="This happens when interests could not be resolved to entities."
        />
      ) : (
        <div className="cd-net">
          <KindFilter
            counts={countsByKind(model.nodes)}
            hidden={hiddenKinds}
            onToggle={(kind) =>
              setHiddenKinds((current) =>
                current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
              )
            }
          />

          {strategy !== "full" ? (
            <p className="cd-net__strategy" role="note">
              {STRATEGY_NOTE[strategy](model.nodes.length, model.groups.length)}
            </p>
          ) : null}

          {mode === "graph" ? (
            <Graph
              layout={layout}
              grouped={grouped}
              selected={selected}
              selectedGroup={selectedGroup}
              onSelectNode={(id) => {
                setSelected(selected === id ? undefined : id);
                setSelectedGroup(undefined);
              }}
              onSelectGroup={(id) => {
                setSelectedGroup(selectedGroup === id ? undefined : id);
                setSelected(undefined);
              }}
              showAllLabels={strategy === "full" && !grouped}
            />
          ) : (
            <NodeTable nodes={nodes} onSelect={setSelected} selected={selected} />
          )}

          {hiddenKinds.length > 0 && nodes.length === 0 ? (
            <p className="cd-net__empty-filter">
              Every node kind is filtered out. Clear the filters above to see the network.
            </p>
          ) : null}

          {active ? <NodeDetail placed={active} edges={model.edges} nodes={model.nodes} /> : null}
          {activeGroup ? (
            <GroupDetail group={activeGroup} nodes={model.nodes} onClear={() => setSelectedGroup(undefined)} />
          ) : null}
        </div>
      )}
    </VizFrame>
  );
}

/**
 * The note strings quote the real thresholds rather than saying "too many".
 *
 * They read `NODE_COUNT_LIMITS` directly — the same table `nodeCountStrategy()`
 * branches on — so a message can never quote a number the strategy does not
 * actually use. The only other copy of these values is the `--node-count-*`
 * tokens in `globals.css`, and
 * `src/lib/design/__tests__/colourRoles.test.ts` asserts the two agree.
 */
const STRATEGY_NOTE: Record<
  Exclude<ReturnType<typeof nodeCountStrategy>, "full">,
  (nodes: number, groups: number) => string
> = {
  filter: (nodes) =>
    `${nodes} nodes is more than the ${NODE_COUNT_LIMITS.full} that can be labelled legibly. Labels are shown for the strongest nodes only — select any node for its name, or filter by kind above.`,
  group: (nodes, groups) =>
    `${nodes} nodes collapsed into ${groups} category groups by default. Expand a group to list what it contains; nothing is dropped from the list view.`,
  list: (nodes) =>
    `${nodes} nodes is past the ${NODE_COUNT_LIMITS.paginate} that can be drawn as a readable network, so it is shown as a list. This is the layout giving up honestly rather than shrinking every node until the chart means nothing.`,
};

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

interface Layout {
  placed: Placed[];
  edges: Array<{ edge: TasteEdge; x1: number; y1: number; x2: number; y2: number }>;
  /** Collapsed groups, present only in grouped mode. */
  bubbles: Array<{ id: string; label: string; role: ColourRole; count: number; x: number; y: number; r: number }>;
}

function Graph({
  layout,
  grouped,
  selected,
  selectedGroup,
  onSelectNode,
  onSelectGroup,
  showAllLabels,
}: {
  layout: Layout;
  grouped: boolean;
  selected: string | undefined;
  selectedGroup: string | undefined;
  onSelectNode: (id: string) => void;
  onSelectGroup: (id: string) => void;
  showAllLabels: boolean;
}) {
  // Typed as a tuple array: an inline `[number, string][]` literal widens to
  // `(string | number)[][]` and the destructure below stops being arithmetic.
  const guideRings = grouped
    ? [RING.declared_interest, GROUP_RING, RING.taste_tag]
    : [RING.declared_interest, RING.derived_category, RING.discovered_entity, RING.taste_tag];
  const ringLabels: ReadonlyArray<readonly [number, string]> = grouped
    ? [
        [RING.declared_interest, "Declared"],
        [GROUP_RING, "Categories"],
        [RING.taste_tag, "Tags"],
      ]
    : [
        [RING.declared_interest, "Declared"],
        [RING.derived_category, "Categories"],
        [RING.discovered_entity, "Discovered"],
        [RING.taste_tag, "Tags"],
      ];

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="cd-net__svg"
      role="img"
      aria-label={`Taste DNA network with ${layout.placed.length} nodes and ${layout.edges.length} links${
        grouped ? `, collapsed into ${layout.bubbles.length} category groups` : ""
      }`}
    >
      {/* Ring guides: faint, so the layering that makes the layout deterministic
          is visible rather than looking like an arbitrary scatter. */}
      {guideRings.map((ring) => (
        <circle
          key={ring}
          cx={CX}
          cy={CY}
          r={R_MAX * ring}
          fill="none"
          stroke="rgb(var(--chart-grid))"
          opacity={0.16}
        />
      ))}

      <g className="cd-net__edges">
        {layout.edges.map(({ edge, x1, y1, x2, y2 }) => (
          <line
            key={edge.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={roleColour(edge.role)}
            strokeWidth={0.6 + clamp01(edge.strength) * 2.4}
            strokeDasharray={RELATION_DASH[edge.relation].dash}
            // Opacity comes from the `--edge-opacity-*` tokens via CSS, not from
            // an attribute here, so the token layer is the thing that decides how
            // loud an edge is. `data-active` is the hook.
            data-active={selected === edge.source || selected === edge.target || undefined}
          />
        ))}
      </g>

      {layout.bubbles.map((bubble) => (
        <g
          key={bubble.id}
          className="cd-net__bubble"
          onClick={() => onSelectGroup(bubble.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectGroup(bubble.id);
            }
          }}
          tabIndex={0}
          role="button"
          aria-pressed={selectedGroup === bubble.id}
          aria-label={`${bubble.label}: ${bubble.count} nodes. Activate to list them.`}
        >
          <title>{`${bubble.label} — ${bubble.count} nodes`}</title>
          <circle
            cx={bubble.x}
            cy={bubble.y}
            r={bubble.r}
            fill={roleColour(bubble.role)}
            fillOpacity={selectedGroup === bubble.id ? 0.3 : 0.14}
            stroke={roleColour(bubble.role)}
            strokeWidth={selectedGroup === bubble.id ? 2.5 : 1.5}
            strokeDasharray="6 4"
          />
          <text
            x={bubble.x}
            y={bubble.y - 2}
            textAnchor="middle"
            className="cd-net__bubble-label"
            fill="rgb(var(--text-ink))"
          >
            {truncate(bubble.label, 15)}
          </text>
          <text
            x={bubble.x}
            y={bubble.y + 13}
            textAnchor="middle"
            className="cd-net__bubble-count"
            fill="rgb(var(--text-muted))"
          >
            {bubble.count}
          </text>
        </g>
      ))}

      {layout.placed.map((placed) => (
        <NetworkNode
          key={placed.node.id}
          placed={placed}
          selected={selected === placed.node.id}
          showLabel={showAllLabels || selected === placed.node.id || placed.node.weight >= 0.72}
          onSelect={() => onSelectNode(placed.node.id)}
        />
      ))}

      {/* Ring labels, placed once, outside the outermost ring. */}
      {ringLabels.map(([ring, label]) => (
        <text
          key={label}
          x={CX + 4}
          y={CY - R_MAX * ring - 4}
          className="cd-net__ring-label"
          fill="rgb(var(--text-faint))"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

function NetworkNode({
  placed,
  selected,
  showLabel,
  onSelect,
}: {
  placed: Placed;
  selected: boolean;
  showLabel: boolean;
  onSelect: () => void;
}) {
  const { node, x, y, angle, radius } = placed;
  const shape = ROLE_SHAPE[node.role] ?? "circle";
  const style = provenanceStyle(node.provenance);
  const size = radius * 2;
  const labelR = RING[node.kind] * R_MAX + 16;
  const { x: lx, y: ly } = polarPoint(CX, CY, labelR, angle);

  return (
    <g
      className="cd-net__node"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${node.label}, ${KIND_LABEL[node.kind]}, weight ${node.weight.toFixed(2)}${
        node.crossDomain ? ", beyond your declared niche" : ""
      }`}
    >
      {/* `<title>` must be the first child or browsers do not surface it. */}
      <title>{`${node.label} — ${KIND_LABEL[node.kind]}${node.crossDomain ? " (cross-domain)" : ""}`}</title>

      {/* Halo: knocks the edges out from behind the glyph so a node sitting on a
          crossing does not read as being connected to it. */}
      <circle cx={x} cy={y} r={radius + 3} fill="rgb(var(--surface-panel))" />

      {node.crossDomain ? (
        // The API's own "beyond your niche" signal (doc 03 §8 step 3). Drawn as an
        // extra ring in the support role — an overlay AROUND the node, so it does
        // not spend the colour channel that already encodes the node's role.
        <circle
          cx={x}
          cy={y}
          r={radius + 4.5}
          fill="none"
          stroke={roleColour("support")}
          strokeWidth={1.75}
          opacity={0.9}
        />
      ) : null}

      <g transform={`translate(${x - radius} ${y - radius})`}>
        <ShapeGlyph
          shape={shape}
          role={node.role}
          size={size}
          hollow={node.provenance === "synthetic"}
          dash={style.dash === "none" ? undefined : style.dash}
          strokeWidth={selected ? 3 : undefined}
        />
      </g>

      {selected ? (
        <circle
          cx={x}
          cy={y}
          r={radius + 8}
          fill="none"
          stroke="rgb(var(--chart-highlight-stroke))"
          strokeWidth={1.5}
          opacity={0.5}
        />
      ) : null}

      {showLabel ? (
        <text
          x={lx}
          y={ly}
          className="cd-net__label"
          textAnchor={anchorFor(lx)}
          dominantBaseline="middle"
          fill={selected ? "rgb(var(--text-ink))" : "rgb(var(--chart-label))"}
        >
          {truncate(node.label, 16)}
        </text>
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Layered radial layout.
 *
 * Rings come from `kind`. Angles are sorted so that related nodes sit near each
 * other: entities are ordered by the category they belong to (which is already
 * score-ordered), and tags by the angle of the entity that contributed most to
 * them. That sorting is what keeps edge crossings low without a simulation — the
 * ordering is derived from the data, so it is stable and explainable.
 */
function radialLayout(nodes: readonly TasteNode[], edges: readonly TasteEdge[]): Layout {
  const declared = nodes.filter((node) => node.kind === "declared_interest");
  const categories = nodes.filter((node) => node.kind === "derived_category");
  const entities = nodes.filter((node) => node.kind === "discovered_entity");
  const tags = nodes.filter((node) => node.kind === "taste_tag");

  const categoryOrder = new Map(categories.map((node, index) => [node.category ?? node.id, index]));

  const sortedEntities = [...entities].sort((a, b) => {
    const ai = a.category === undefined ? Number.MAX_SAFE_INTEGER : (categoryOrder.get(a.category) ?? Number.MAX_SAFE_INTEGER);
    const bi = b.category === undefined ? Number.MAX_SAFE_INTEGER : (categoryOrder.get(b.category) ?? Number.MAX_SAFE_INTEGER);
    return ai - bi || b.weight - a.weight || a.label.localeCompare(b.label);
  });

  const placed: Placed[] = [
    ...place(declared, RING.declared_interest),
    ...place(categories, RING.derived_category),
    ...place(sortedEntities, RING.discovered_entity),
  ];

  // Tags are ordered last because their angle depends on the entities already
  // being positioned. `byId` is built from `placed`, so it is available here.
  const byId = new Map(placed.map((item) => [item.node.id, item]));
  const sortedTags = [...tags].sort((a, b) => tagAngle(a, edges, byId) - tagAngle(b, edges, byId));
  placed.push(...place(sortedTags, RING.taste_tag));

  const positions = new Map(placed.map((item) => [item.node.id, item]));

  return {
    placed,
    bubbles: [],
    edges: edges.flatMap((edge) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (from === undefined || to === undefined) return [];
      return [{ edge, x1: from.x, y1: from.y, x2: to.x, y2: to.y }];
    }),
  };
}

function place(nodes: readonly TasteNode[], ring: number): Placed[] {
  const radius = R_MAX * ring;
  return nodes.map((node, index) => {
    // Offset by half a step so a single node does not sit exactly at 12 o'clock
    // overlapping the ring label.
    const angle = nodes.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    // `radius` here is the RING radius, not the node's own — the field of that
    // name below is `nodeRadius(node.weight)`. Only the position goes through
    // `polarPoint`: a radius is plain arithmetic on a weight that arrived from
    // the server and is therefore bit-identical on both sides, whereas a sine is
    // implementation-approximated and is not. See `deterministic.ts`.
    const { x, y } = polarPoint(CX, CY, radius, angle);
    return {
      node,
      angle,
      radius: nodeRadius(node.weight),
      x,
      y,
    };
  });
}

function nodeRadius(weight: number): number {
  return 5.5 + clamp01(weight) * 9;
}

/** Angle of the entity that contributed most to a tag; `Number.MAX_SAFE_INTEGER`-free fallback. */
function tagAngle(
  tag: TasteNode,
  edges: readonly TasteEdge[],
  byId: ReadonlyMap<string, Placed>,
): number {
  let best: Placed | undefined;
  let bestStrength = -1;
  for (const edge of edges) {
    if (edge.target !== tag.id) continue;
    const source = byId.get(edge.source);
    if (source === undefined) continue;
    if (edge.strength > bestStrength) {
      bestStrength = edge.strength;
      best = source;
    }
  }
  // Unconnected tags sort to the end of the ring rather than to angle 0, which
  // would pile every orphan onto the same point.
  return best === undefined ? Math.PI * 1.5 + hashAngle(tag.id) : best.angle;
}

/** A stable pseudo-angle from an id, so orphan tags spread out deterministically. */
function hashAngle(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100003;
  }
  return (hash / 100003) * Math.PI * 0.4;
}

/**
 * Grouped layout: declared interests, one bubble per category, and the tag ring.
 *
 * The bubbles are drawn from `model.groups`, whose `nodeIds` come from the same
 * `category` field the expanded view uses, so a group's count is the count of
 * nodes the expanded view would have drawn — no separate bookkeeping that could
 * drift. Aggregated declared → group links are the MEAN strength of the member
 * links they replace, and the detail panel reports how many links were merged, so
 * collapsing never silently invents a single stronger connection.
 */
function groupedLayout(model: TasteDnaNetworkViewModel, nodes: readonly TasteNode[]): Layout {
  const declared = nodes.filter((node) => node.kind === "declared_interest");
  const tags = nodes.filter((node) => node.kind === "taste_tag");

  const placed: Placed[] = [...place(declared, RING.declared_interest), ...place(tags, RING.taste_tag)];
  const byId = new Map(placed.map((item) => [item.node.id, item]));
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));

  const bubbles = model.groups.flatMap((group, index) => {
    const members = group.nodeIds.flatMap((id) => {
      const node = nodeById.get(id);
      return node === undefined || !nodes.includes(node) ? [] : [node];
    });
    if (members.length === 0) return [];
    const angle = (Math.PI * 2 * index) / Math.max(1, model.groups.length) - Math.PI / 2;
    const radius = R_MAX * GROUP_RING;
    const { x, y } = polarPoint(CX, CY, radius, angle);
    return [
      {
        id: group.id,
        label: group.label,
        role: group.role,
        count: members.length,
        x,
        y,
        r: 16 + Math.min(26, members.length * 1.8),
      },
    ];
  });

  const bubbleById = new Map(bubbles.map((bubble) => [bubble.id, bubble]));
  const groupOfNode = new Map<string, string>();
  for (const group of model.groups) {
    for (const id of group.nodeIds) groupOfNode.set(id, group.id);
  }

  // Aggregate declared → group links.
  const aggregated = new Map<string, { total: number; count: number; role: ColourRole; relation: TasteEdge["relation"] }>();
  for (const edge of model.edges) {
    const from = byId.get(edge.source);
    if (from === undefined) continue;
    const targetNode = nodeById.get(edge.target);
    if (targetNode === undefined) continue;
    const groupId = targetNode.category === undefined ? undefined : groupOfNode.get(targetNode.id);
    if (groupId === undefined) continue;
    const key = `${edge.source}->${groupId}`;
    const existing = aggregated.get(key);
    aggregated.set(key, {
      total: (existing?.total ?? 0) + edge.strength,
      count: (existing?.count ?? 0) + 1,
      role: edge.role,
      relation: edge.relation,
    });
  }

  const groupedEdges = [...aggregated.entries()].flatMap(([key, value]) => {
    // `key.split` returns `string[]`, so under `noUncheckedIndexedAccess` both
    // halves are `string | undefined`. Guard them here rather than relying on the
    // `bubble === undefined` check below to imply `groupId` is defined — it does
    // imply it to a reader, but not to the compiler.
    const [sourceId, groupId] = key.split("->");
    if (sourceId === undefined || groupId === undefined) return [];
    const from = byId.get(sourceId);
    const bubble = bubbleById.get(groupId);
    if (from === undefined || bubble === undefined) return [];
    return [
      {
        edge: {
          id: key,
          source: sourceId,
          target: groupId,
          strength: value.total / value.count,
          relation: value.relation,
          role: value.role,
        } satisfies TasteEdge,
        x1: from.x,
        y1: from.y,
        x2: bubble.x,
        y2: bubble.y,
      },
    ];
  });

  return { placed, bubbles, edges: groupedEdges };
}

/** Drop edges whose endpoint was filtered out, so a filter cannot leave a line hanging. */
function filterEdges(
  edges: readonly TasteEdge[],
  nodes: readonly TasteNode[],
  hiddenKinds: readonly TasteNodeKind[],
): TasteEdge[] {
  if (hiddenKinds.length === 0) return [...edges];
  const ids = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

function countsByKind(nodes: readonly TasteNode[]): Record<TasteNodeKind, number> {
  const counts: Record<TasteNodeKind, number> = {
    declared_interest: 0,
    derived_category: 0,
    discovered_entity: 0,
    taste_tag: 0,
  };
  for (const node of nodes) counts[node.kind] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Controls and panels
// ---------------------------------------------------------------------------

function KindFilter({
  counts,
  hidden,
  onToggle,
}: {
  counts: Record<TasteNodeKind, number>;
  hidden: readonly TasteNodeKind[];
  onToggle: (kind: TasteNodeKind) => void;
}) {
  const kinds = Object.keys(KIND_LABEL) as TasteNodeKind[];
  return (
    <div className="cd-net__filters" role="group" aria-label="Filter nodes by kind">
      {kinds.map((kind) => {
        const count = counts[kind];
        if (count === 0) return null;
        const isHidden = hidden.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            className="cd-chip cd-chip--filter"
            data-selected={!isHidden}
            onClick={() => onToggle(kind)}
            aria-pressed={!isHidden}
          >
            {KIND_LABEL[kind]}
            <span className="cd-chip__count cd-tabular">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function NodeDetail({
  placed,
  edges,
  nodes,
}: {
  placed: Placed;
  edges: readonly TasteEdge[];
  nodes: readonly TasteNode[];
}) {
  const { node } = placed;
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const links = edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const style = provenanceStyle(node.provenance);

  return (
    <div className="cd-net__detail" role="region" aria-label={`Detail for ${node.label}`}>
      <div className="cd-net__detail-head">
        <ShapeGlyph shape={ROLE_SHAPE[node.role] ?? "circle"} role={node.role} size={16} />
        <h4>{node.label}</h4>
        <span className="cd-eyebrow">{KIND_LABEL[node.kind]}</span>
      </div>
      <dl className="cd-net__detail-facts">
        <div>
          <dt>Weight</dt>
          <dd className="cd-tabular">{node.weight.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{style.label}</dd>
        </div>
        {node.category ? (
          <div>
            <dt>Category</dt>
            <dd>{node.category}</dd>
          </div>
        ) : null}
        {node.crossDomain ? (
          <div>
            <dt>Cross-domain</dt>
            <dd>Surfaced beyond your declared niche</dd>
          </div>
        ) : null}
      </dl>
      {links.length > 0 ? (
        <ul className="cd-net__links">
          {links.map((edge) => {
            const otherId = edge.source === node.id ? edge.target : edge.source;
            const other = byId.get(otherId);
            return (
              <li key={edge.id}>
                <span className="cd-net__link-relation">{RELATION_DASH[edge.relation].label}</span>
                <span>{other?.label ?? otherId}</span>
                <span className="cd-tabular">{edge.strength.toFixed(3)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cd-net__no-links">
          This node has no links in the current view. It was produced by the analysis but nothing in
          this network connects to it — that is a property of the data, not of the drawing.
        </p>
      )}
    </div>
  );
}

function GroupDetail({
  group,
  nodes,
  onClear,
}: {
  group: TasteDnaNetworkViewModel["groups"][number];
  nodes: readonly TasteNode[];
  onClear: () => void;
}) {
  const members = group.nodeIds
    .flatMap((id) => {
      const node = nodes.find((item) => item.id === id);
      return node === undefined ? [] : [node];
    })
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));

  return (
    <div className="cd-net__detail" role="region" aria-label={`Contents of ${group.label}`}>
      <div className="cd-net__detail-head">
        <h4>{group.label}</h4>
        <span className="cd-eyebrow">{members.length} nodes</span>
        <button type="button" className="cd-button cd-button--ghost cd-button--xs" onClick={onClear}>
          Close
        </button>
      </div>
      <ul className="cd-net__members">
        {members.map((member) => (
          <li key={member.id}>
            <ShapeGlyph shape={ROLE_SHAPE[member.role] ?? "circle"} role={member.role} size={12} />
            <span>{member.label}</span>
            <span className="cd-tabular">{member.weight.toFixed(3)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodeTable({
  nodes,
  selected,
  onSelect,
}: {
  nodes: readonly TasteNode[];
  selected: string | undefined;
  onSelect: (id: string) => void;
}) {
  const sorted = [...nodes].sort(
    (a, b) => a.kind.localeCompare(b.kind) || b.weight - a.weight || a.label.localeCompare(b.label),
  );

  return (
    <div className="cd-net__table">
      <table className="cd-table">
        <caption>{nodes.length} nodes, grouped by kind and ordered by weight</caption>
        <thead>
          <tr>
            <th scope="col">Node</th>
            <th scope="col">Kind</th>
            <th scope="col">Weight</th>
            <th scope="col">Source</th>
            <th scope="col">Cross-domain</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((node) => (
            <tr
              key={node.id}
              className={selected === node.id ? "cd-table__row--active" : undefined}
              onClick={() => onSelect(node.id)}
            >
              <th scope="row">
                <span className="cd-net__table-node">
                  <ShapeGlyph shape={ROLE_SHAPE[node.role] ?? "circle"} role={node.role} size={12} />
                  {node.label}
                </span>
              </th>
              <td>{KIND_LABEL[node.kind]}</td>
              <td className="cd-tabular">{node.weight.toFixed(3)}</td>
              <td>{provenanceStyle(node.provenance).label}</td>
              <td>{node.crossDomain ? "Yes" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anchorFor(x: number): "start" | "middle" | "end" {
  const offset = x - CX;
  if (offset > 10) return "start";
  if (offset < -10) return "end";
  return "middle";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
