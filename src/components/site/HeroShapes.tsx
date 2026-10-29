"use client";

import { useEffect, useRef, useState } from "react";

import type { HeroShapePlacement } from "./heroLayout";
import type { HeroSceneTeardown, createHeroScene } from "./heroScene";

/**
 * The hero's WebGL shape field (doc 05 §2, §4, §6, §14; R13).
 *
 * Renders a single transparent `<canvas>` inside an absolutely-positioned,
 * masked, `aria-hidden` wrapper that sits BEHIND the hero copy and the product
 * panel. It is decorative and takes no pointer events.
 *
 * THE CANVAS IS SERVER-RENDERED; ONLY `three` IS DEFERRED
 * -------------------------------------------------------
 * This is an ordinary Client Component with no `next/dynamic` and no `ssr: false`.
 * The wrapper and the `<canvas>` are therefore in the server HTML, and the client's
 * first render matches them exactly. `three` is loaded by a runtime `import()`
 * inside the effect below, which puts it — and `./heroScene`, the only module that
 * imports it — in an async chunk fetched after hydration. `next/dynamic` with
 * `ssr: false` would split the bundle just as well, but it replaces the
 * server-rendered `<canvas>` with a `BAILOUT_TO_CLIENT_SIDE_RENDERING`
 * placeholder; `heroScene.ts` covers the reasoning, and what that choice was
 * once, incorrectly, blamed for.
 *
 * WHAT IT DRAWS
 * -------------
 * Nothing is decided here. `heroLayout.ts` picks the forms and lays them out on
 * the server; `heroScene.ts` builds the scene. This file's only jobs are the
 * capability probe, the load, and the teardown — which is why it can be read in
 * one sitting.
 *
 * WHY THE PROBE IS SEPARATE FROM THE LOAD
 * ---------------------------------------
 * Both end in the same place (`unsupported`), but they answer different
 * questions, and keeping them apart means a browser with no WebGL never downloads
 * several hundred kilobytes of rendering library to find that out.
 */

interface HeroShapesProps {
  /**
   * Pre-laid-out on the server by `heroShapeLayout`. Plain primitives, so this
   * crosses no boundary carrying a `TasteNode` and its entity payload.
   */
  placements: readonly HeroShapePlacement[];
}

/**
 * Whether a WebGL context can be created at all.
 *
 * Probed on a throwaway canvas rather than on the real one, because a failed
 * `getContext` on the renderer's canvas leaves it in a state that is awkward to
 * recover from, and because the answer is needed before `three` is worth
 * downloading. Wrapped in try/catch: `getContext` itself throws in some privacy
 * modes rather than returning null.
 */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement("canvas");
    const context =
      probe.getContext("webgl2") ??
      probe.getContext("webgl") ??
      probe.getContext("experimental-webgl");
    return context !== null;
  } catch {
    return false;
  }
}

export function HeroShapes({ placements }: HeroShapesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!webglAvailable()) {
      setUnsupported(true);
      return;
    }

    // The load is async, so the effect can return before it resolves. Without
    // this flag a component unmounted mid-download — a fast navigation away from
    // the homepage — would build a scene against a canvas React has already
    // removed, and leak the GPU context it just created.
    let cancelled = false;
    let teardown: HeroSceneTeardown | null = null;

    void (async () => {
      // Renamed on the way in, so the local does not shadow the type-only import
      // it is annotated with. `typeof import("...")` would be shorter but this
      // repo's `consistent-type-imports` forbids inline `import()` types.
      let createScene: typeof createHeroScene;
      try {
        ({ createHeroScene: createScene } = await import("./heroScene"));
      } catch {
        // Chunk blocked, offline, or a CSP that forbids the worker `three`
        // compiles shaders in. A decorative layer that cannot load is not an
        // error worth surfacing; the hero is complete without it.
        if (!cancelled) setUnsupported(true);
        return;
      }
      if (cancelled) return;

      try {
        teardown = createScene(canvas, placements);
      } catch {
        // Scene construction touches a lot of driver-dependent surface. Anything
        // thrown here is caught rather than propagated, because an unhandled
        // rejection from a background decoration would land in the page's error
        // boundary and take the hero's copy with it.
        teardown = null;
      }
      if (teardown === null && !cancelled) setUnsupported(true);
    })();

    return () => {
      cancelled = true;
      if (teardown !== null) teardown();
    };
  }, [placements]);

  if (placements.length === 0 || unsupported) return null;

  return (
    <div className="cd-hero__field" aria-hidden="true">
      <canvas ref={canvasRef} className="cd-hero__canvas" />
    </div>
  );
}

export default HeroShapes;
