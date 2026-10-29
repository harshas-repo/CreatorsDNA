import type { CulturalTag } from "@/lib/contracts/domain";

/**
 * Tag namespace curation — doc 03 §17, contradiction #16.
 *
 * The problem this solves: Qloo's concept documentation promises taste-level
 * tags such as *"award-winning"* and *"Foodie Destination"*, but the documented
 * `/v2/tags` example for `urn:tag:keyword:media` returned plot keywords —
 * *"Mining Accident"*, *"Anthropomorphic Elephant"*, *"Gasoline Fire"*,
 * *"Woman Farting"*, *"Eiffel Tower Destroyed"*.
 *
 * Surfacing those as a creator's "cultural taste" would be worse than showing
 * nothing. So curation is mandatory, and it is a **default-deny** policy:
 *
 *   HARD DENY  plot-keyword namespaces. Not overridable by configuration.
 *   ALLOW      namespaces the documentation names as taste-level.
 *   UNLISTED   withheld by default, but RECORDED — so the live probe shows
 *              exactly which namespaces to add rather than silently losing them.
 *
 * The allow-list cannot be completed before the probe (doc 04 §4.2), but the
 * mechanism can. Enumerating `/v2/tags/types` is the probe step that fills it in.
 */

export type NamespaceVerdict = "allow" | "deny" | "unlisted";

/**
 * Namespaces treated as taste-level. Each entry is a prefix, so `urn:tag:genre`
 * covers `urn:tag:genre:media`, `urn:tag:genre:music`, and so on.
 *
 * Sourced from doc 03 §6/§17: *"prefer genre / style / interest namespaces
 * (`urn:tag:genre:*`, `urn:tag:style:qloo:*`, audience namespaces such as
 * `urn:audience:hobbies_and_interests`) over `urn:tag:keyword:*`."*
 */
export const ALLOWED_TAG_NAMESPACE_PREFIXES = [
  "urn:tag:genre",
  "urn:tag:style",
  "urn:tag:theme",
  "urn:tag:mood",
  "urn:tag:interest",
  "urn:audience",
] as const;

/**
 * Plot-keyword namespaces. These describe what HAPPENS IN a work, not what
 * someone's taste IS. Hard-denied.
 */
export const DENIED_TAG_NAMESPACE_PREFIXES = ["urn:tag:keyword", "urn:tag:plot"] as const;

export interface TagCurationOptions {
  /**
   * Development escape hatch. When true, unlisted namespaces are surfaced
   * instead of withheld. Defaults to false: doc 03 §17 requires that an
   * unlisted tag never reach the UI, and the safe failure is silence rather
   * than an embarrassing plot keyword in a taste profile.
   */
  allowUnlisted?: boolean;
}

/**
 * Reduce a tag id or type to its namespace.
 *
 * Qloo tag ids are `<type>:<slug>` — e.g. `urn:tag:genre:media:action` has type
 * `urn:tag:genre:media`. Audience URNs are one segment shorter.
 */
export function namespaceOf(idOrType: string): string {
  const parts = idOrType.split(":");
  if (parts[0] === "urn" && parts[1] === "tag" && parts.length >= 4) {
    return parts.slice(0, 4).join(":");
  }
  if (parts[0] === "urn" && parts[1] === "audience" && parts.length >= 3) {
    return parts.slice(0, 3).join(":");
  }
  if (parts.length >= 3) return parts.slice(0, 3).join(":");
  return idOrType;
}

/**
 * The CONCEPT a tag id names, one level below its namespace.
 *
 * Qloo's tag ids are hierarchical: `urn:tag:genre:brand:fashion`,
 * `…:fashion:footwear`, `…:fashion:footwear:other`, `…:fashion:formalwear` and
 * `…:fashion:casual` are five distinct ids and one concept. Observed live on a
 * single brand entity, which carried all five.
 *
 * WHY THIS EXISTS AND WHAT IT MUST NEVER BE USED FOR
 * --------------------------------------------------
 * Counting breadth. A strength label is allowed to say an overlap is "broad"
 * only when it spans several distinct cultural dimensions, and five
 * representations of *fashion* is not five dimensions — it is one, said five
 * times. Counting ids instead let a single concept buy a breadth claim it had
 * not earned.
 *
 * It is NOT a matching rule, and must not become one. Two ids are never treated
 * as the same concept for the purpose of finding an overlap: matching stays an
 * exact identity between catalogue ids, because collapsing `fashion:casual` and
 * `fashion:formalwear` into one another in order to MATCH them would be the
 * hand-authored semantic mapping §5.1 forbids — inventing a relationship the
 * provider never stated, in the direction that increases the match count. The
 * collapse runs only over dimensions that already matched by exact id, and only
 * to count how many distinct ideas they represent.
 *
 * The rule is structural, not lexical: take the namespace `namespaceOf` already
 * derives, then the first slug segment after it. No word list, no synonyms, no
 * knowledge of what any segment means.
 */
export function conceptOf(idOrType: string): string {
  const namespace = namespaceOf(idOrType);
  const remainder = idOrType.startsWith(`${namespace}:`)
    ? idOrType.slice(namespace.length + 1)
    : idOrType;
  const first = remainder.split(":")[0] ?? remainder;
  return `${namespace}:${first}`.toLowerCase();
}

export function classifyNamespace(namespace: string): NamespaceVerdict {
  const lower = namespace.toLowerCase();
  if (DENIED_TAG_NAMESPACE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return "deny";
  if (ALLOWED_TAG_NAMESPACE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return "allow";
  return "unlisted";
}

/** Whether a tag may be shown to a creator as part of their taste profile. */
export function isSurfaceableTag(tag: CulturalTag, options: TagCurationOptions = {}): boolean {
  const namespace = tag.namespace ?? namespaceOf(tag.id);
  const verdict = classifyNamespace(namespace);
  if (verdict === "deny") return false;
  if (verdict === "allow") return true;
  return options.allowUnlisted === true;
}

/** Partition a tag list, so withheld namespaces can be reported not discarded. */
export function partitionTags(
  tags: readonly CulturalTag[],
  options: TagCurationOptions = {},
): {
  surfaceable: CulturalTag[];
  withheldDenied: CulturalTag[];
  withheldUnlisted: CulturalTag[];
  /** Distinct unlisted namespaces — the to-do list produced by the live probe. */
  unlistedNamespaces: string[];
} {
  const surfaceable: CulturalTag[] = [];
  const withheldDenied: CulturalTag[] = [];
  const withheldUnlisted: CulturalTag[] = [];
  const unlistedNamespaces = new Set<string>();

  for (const tag of tags) {
    const namespace = tag.namespace ?? namespaceOf(tag.id);
    const verdict = classifyNamespace(namespace);
    if (verdict === "deny") {
      withheldDenied.push(tag);
      continue;
    }
    if (verdict === "allow") {
      surfaceable.push(tag);
      continue;
    }
    unlistedNamespaces.add(namespace);
    if (options.allowUnlisted === true) surfaceable.push(tag);
    else withheldUnlisted.push(tag);
  }

  return {
    surfaceable,
    withheldDenied,
    withheldUnlisted,
    unlistedNamespaces: [...unlistedNamespaces].sort(),
  };
}

/** Rendered wherever taste tags appear, so the filtering is disclosed. */
export function describeCurationPolicy(): string {
  return [
    "Cultural tags are filtered by namespace before display.",
    `Allowed namespaces: ${ALLOWED_TAG_NAMESPACE_PREFIXES.join(", ")}.`,
    `Excluded namespaces: ${DENIED_TAG_NAMESPACE_PREFIXES.join(", ")} (plot keywords describe what happens in a work, not what a taste is).`,
    "Namespaces outside both lists are withheld until they have been reviewed.",
  ].join(" ");
}
