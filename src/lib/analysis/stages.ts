/**
 * The canonical pipeline stage list and the streamed progress event.
 *
 * This module is deliberately NOT `server-only`. The pipeline emits `StageEvent`s
 * from the server and the analyzing screen renders the SAME ordered list on the
 * client, lighting each step up as its event arrives over the streamed response.
 * Sharing one list is what stops the UI promising nine stages while the pipeline
 * runs ten — the exact drift `flowTypes.ts` exists to prevent for the wizard rail.
 *
 * The labels reuse the wording the analyzing screen already showed, so streaming
 * changes WHEN a step lights up, not what it says. The list is the real sequence
 * of boundaries in `runAnalysis()`: interest resolution, the four parallel
 * provider calls, the silent-ignore canary, taste assembly, opportunity
 * derivation, brand scoring and the view-model build.
 */

/** What happened to a stage. `start` is emitted before the work, `done` after it
 *  produced a result, and `skipped` when the stage ran no work at all (no
 *  signals, an unsupported capability, or a pre-resolved input). */
export type StageStatus = "start" | "done" | "skipped";

export interface StageEvent {
  id: PipelineStageId;
  label: string;
  status: StageStatus;
}

/**
 * The stages, in the order `runAnalysis()` reaches them.
 *
 * `as const` so `PipelineStageId` is a closed union: adding a stage here is a
 * compile error everywhere a `Record<PipelineStageId, …>` is built until the new
 * id is handled, which is the guard that keeps the client's progress map total.
 *
 * THE ORDER IS THE ARGUMENT. It reads as the process the product actually runs —
 * understand the creator, expand what they confirmed into a cultural profile,
 * discover brands across that profile, work out each brand's own cultural profile,
 * compare the two, and only then rank. Brand discovery and the intersection used to
 * sit earlier and in parallel with the taste build, which is why the old list could
 * not show them: a brand list was being chosen before there was a taste profile to
 * choose it against. The labels are the creator-facing wording, so they name the
 * concepts the product uses ("Creator Taste DNA", "cultural connections") and never
 * claim a measurement of anyone's audience.
 */
export const PIPELINE_STAGES = [
  { id: "interests", label: "Resolving each interest to a specific catalogue entity" },
  { id: "recommendations", label: "Requesting recommendations for every entity type that resolved" },
  { id: "tags", label: "Harvesting the cultural tags attached to what came back" },
  { id: "demographics", label: "Reading the demographic context returned for your signals" },
  { id: "canary", label: "Re-asking with fewer signals, to check the answers actually change" },
  { id: "taste", label: "Assembling your Creator Taste DNA, normalised within each returned set" },
  { id: "brands", label: "Discovering brands across that cultural profile, not just the interests you typed" },
  { id: "intersection", label: "Reading each brand's own cultural profile and comparing it with yours" },
  { id: "opportunities", label: "Finding the cultural connections you have not made content in yet" },
  { id: "scoring", label: "Ranking on the overlap, and re-weighting the dimensions with no data" },
  { id: "viewmodels", label: "Building the graphs, the seal and the brand list" },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];

const LABEL_BY_ID: ReadonlyMap<PipelineStageId, string> = new Map(
  PIPELINE_STAGES.map((stage) => [stage.id, stage.label]),
);

/** Build a full event from an id and a status. The label is looked up, never
 *  passed at the call site, so the pipeline cannot emit a label that disagrees
 *  with the list the client renders. */
export function stageEvent(id: PipelineStageId, status: StageStatus): StageEvent {
  return { id, label: LABEL_BY_ID.get(id) ?? id, status };
}

// ---------------------------------------------------------------------------
// Client-side progress fold
// ---------------------------------------------------------------------------

/** A stage the client has not heard about yet. */
export type StageProgressState = "pending" | StageStatus;

/**
 * The client's view of the run: every stage starts `pending` and is replaced by
 * the status from its event. Total over `PipelineStageId` by construction, so the
 * analyzing screen can render the whole list before the first event lands.
 */
export type StageProgress = Record<PipelineStageId, StageProgressState>;

export function initialStageProgress(): StageProgress {
  const progress = {} as StageProgress;
  for (const stage of PIPELINE_STAGES) progress[stage.id] = "pending";
  return progress;
}

/**
 * Fold one event into the progress map, immutably (React state).
 *
 * An id the client does not know is ignored rather than added: a server ahead of
 * the client's list must not crash the render, and a replayed or malformed event
 * must not invent a step that the ordered list has no row for.
 */
export function applyStageEvent(progress: StageProgress, event: StageEvent): StageProgress {
  if (!(event.id in progress)) return progress;
  return { ...progress, [event.id]: event.status };
}

/** True once every stage has settled, so the screen can clear `aria-busy`. */
export function isStageProgressSettled(progress: StageProgress): boolean {
  return PIPELINE_STAGES.every(
    (stage) => progress[stage.id] === "done" || progress[stage.id] === "skipped",
  );
}
