import * as THREE from "three";

import { ROLE_RGB, ROLE_TOKEN } from "@/lib/design/colourRoles";
import { HERO_SHAPE_LIMIT_COARSE } from "./heroLayout";
import { clamp } from "@/lib/utils/deterministic";

import type { ColourRole } from "@/lib/contracts/viewModels";
import type { HeroMaterial, HeroShapePlacement } from "./heroLayout";

/**
 * The hero's WebGL scene: construction, animation and teardown.
 *
 * CLIENT-ONLY. This module reads `window`, `document` and `getComputedStyle`, and
 * it is reachable solely through the runtime `import()` inside `HeroShapes.tsx`'s
 * effect. That indirection is the whole reason it is a separate file: `three` is
 * several hundred kilobytes, and a module that only a dynamic `import()` can reach
 * is emitted as a chunk of its own, fetched after the hero has painted. Nothing in
 * the server graph, and nothing in the page's First Load JS, ever sees it.
 *
 * The obvious alternative is `next/dynamic` with `ssr: false`. It gets the same
 * bundle split, but the server then emits a `BAILOUT_TO_CLIENT_SIDE_RENDERING`
 * marker and a Suspense placeholder in place of the component's markup, so the
 * field is absent from the initial HTML and costs an extra round trip after
 * hydration. Importing at runtime keeps the split and still server-renders the
 * `<canvas>`, which is why it is preferred — no stronger reason than that.
 *
 * It is worth recording what is NOT true here, because it was believed once and
 * cost a full debugging cycle to disprove: `ssr: false` was not the cause of the
 * "Minified React error #418" this page used to throw. Removing it was verified
 * to leave the error byte-identical. The two real causes were ULP-divergent
 * `Math.sin` in server-rendered SVG coordinates (see `polarPoint` in
 * `lib/utils/deterministic.ts`) and multi-child SVG `<title>` elements (see
 * `tests/svgTitle.test.ts`). Both are asserted there so neither can come back.
 *
 * WHAT IT DRAWS, AND WHY THAT IS NOT "GENERIC 3D SHAPES"
 * ------------------------------------------------------
 * Doc 01 §24 forbids generic 3D shapes in the hero while doc 05 §2 makes abstract
 * 3D forms a core part of the identity. `heroLayout.ts` carries the full argument;
 * the short version is that every form here is a node from the real analysis,
 * shaped by `ROLE_SHAPE`, coloured by the `--role-*` tokens and given a material
 * by its `kind`. Nothing is invented for this scene.
 *
 * COLOURS ARE READ FROM THE CASCADE, NOT FROM `ROLE_RGB`
 * ------------------------------------------------------
 * `ROLE_RGB` is pinned by `colourRoles.test.ts` to the LIGHT palette, because that
 * is what `inkOnRole()` needs in order to stay a pure function. `--role-support`
 * diverges in the dark theme. So this scene resolves every colour through
 * `getComputedStyle`, with `ROLE_RGB` only as the fallback for the case where the
 * cascade cannot be read at all. A `MutationObserver` on `data-theme` re-resolves
 * and re-tints in place, so a theme switch recolours the field without rebuilding
 * it. Skipping that step is how a WebGL scene ends up painting navy forms on a
 * navy background.
 *
 * EVERY GUARD BELOW IS FROM DOC 05 §14 OR §6, NOT FROM CAUTION
 * ------------------------------------------------------------
 * reduced motion → exactly one frame, never a loop; off-screen → paused; hidden
 * tab → paused; coarse pointer → fewer forms and a lower pixel ratio; teardown →
 * every geometry, material and the context itself released.
 */

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------

/** Degrees. Narrow enough to keep perspective from bulging the outer forms. */
const CAMERA_FOV = 38;
const CAMERA_DISTANCE = 10;
/** World units between the near plane and the furthest form. */
const DEPTH_RANGE = 5;
/** World radius of a form at `scale` 1, before the depth cue. */
const BASE_RADIUS = 0.44;

const KEY_INTENSITY = 1.5;
/**
 * Art direction, not a token: how hard the navy fill light rims the far side of
 * each form. `--shape-shadow` supplies its colour, so it re-tints with the theme.
 */
const FILL_INTENSITY = 0.9;

/**
 * Converts `--shape-ambient-opacity` into an ambient light intensity.
 *
 * The CSS token expresses ambient as an OPACITY in a layered 2D system; a light
 * rig needs an INTENSITY. Rather than picking a number, treat the token as the
 * fraction of the scene's light that is non-directional and solve for it against
 * the key light: `ambient / (ambient + key) = opacity`. At the token's 0.16 that
 * is a fairly dark ambient, which is deliberate — the forms are lit from one
 * direction and the shadow side falls into navy, which is the look the token set
 * describes.
 */
function ambientIntensityFrom(opacity: number): number {
  const share = clamp(opacity, 0, 0.95);
  return (KEY_INTENSITY * share) / (1 - share);
}

/** How much of the field's width is used, leaving a margin at the hero's edges. */
const FIELD_SPREAD = 0.92;
/**
 * Rightward bias applied on wide viewports. The copy column occupies the
 * inline-start half of the hero, so shifting the field's centre toward the
 * inline-end keeps the densest part of the composition behind the product panel
 * and the outer edge, where it has room, instead of behind the largest text on
 * the page. The bias is strong enough that the left-aligned headline and lede sit
 * in clear space rather than behind a form: the composition still wraps the
 * typography, but the forms read from the centre of the field outward, not from
 * directly under the copy. The value is tuned against a rendered wide-viewport
 * frame, not guessed: at 0.3 roughly a third of the field's painted pixels still
 * landed inside the headline's glyph box, because the ring's horizontal reach
 * (u * FIELD_SPREAD * halfWidth, ~430px at the hero's widest) outreaches a small
 * centre shift while the copy column runs to ~half the canvas. 0.55 pushes the
 * left arc of the field past the copy column so the headline and lede sit in
 * clear space, at the cost of the outermost forms passing behind the product
 * panel and the right edge — which is where the comment above wants them.
 * Contrast is still protected in CSS (`prefers-contrast: more` hides the field
 * outright); this is composition, not accessibility.
 */
const WIDE_ASPECT = 1.25;
const WIDE_BIAS = 0.55;
/**
 * How far the field is stretched horizontally once the canvas is narrower than
 * `WIDE_ASPECT`, interpolated so it reaches this at an aspect of zero.
 *
 * Below the two-column breakpoint the copy column is nearly the full width, so
 * there is nowhere to put a form that is not behind a paragraph. Pushing the ring
 * outward moves the forms into the margins and past the frame. That is the better
 * of the two available outcomes: a form cut off by the canvas edge still reads as
 * part of a larger field, which is what doc 05 §4 means by the composition
 * "extending around" the typography, whereas the same form pulled inward reads as
 * a blob sitting behind a sentence.
 */
const NARROW_SPREAD = 1.45;

/** Lerp factor for pointer parallax. Low enough that it reads as drift. */
const PARALLAX_EASE = 0.055;
const PARALLAX_LIMIT = 0.07;

type Rgb = [number, number, number];

interface SceneTokens {
  highlight: Rgb;
  shadow: Rgb;
  /** Unit vector pointing from the origin toward the key light. */
  lightDirection: THREE.Vector3;
  ambientIntensity: number;
  matteRoughness: number;
  glossRoughness: number;
  glossClearcoat: number;
  glossClearcoatRoughness: number;
  glassRoughness: number;
  glassOpacity: number;
  /** Ambient float travel, in CSS pixels, from `--shape-float-distance`. */
  floatPx: number;
  /** Far-form scale multiplier, from `--shape-scale-far`. */
  scaleFar: number;
  /** Ambient float period in seconds, from `--duration-ambient`. */
  periodSeconds: number;
}

// ---------------------------------------------------------------------------
// Token reading
// ---------------------------------------------------------------------------

const HIGHLIGHT_FALLBACK: Rgb = [255, 255, 255];
const SHADOW_FALLBACK: Rgb = [11, 16, 48];

/**
 * Every token read goes through these three helpers, and every one of them has a
 * fallback. A decorative background layer must never be able to break the page,
 * and an unparseable or absent custom property is the most likely way for it to
 * try.
 */
function cssVariable(name: string): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? undefined : value;
}

/**
 * `parseFloat` rather than `Number`, because the tokens carry units: `18px`, `9s`,
 * `135deg`. `Number("18px")` is `NaN`; `parseFloat("18px")` is `18`.
 */
function numberVariable(name: string, fallback: number): number {
  const raw = cssVariable(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rgbVariable(name: string, fallback: Rgb): Rgb {
  const raw = cssVariable(name);
  if (raw === undefined) return fallback;
  const channels = raw
    .split(/[\s,/]+/)
    .filter((part) => part !== "")
    .map(Number.parseFloat);
  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined) return fallback;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return fallback;
  return [r, g, b];
}

/**
 * A role colour from the cascade, falling back to the literal light-palette value.
 * See the file header for why the cascade is primary.
 */
function roleRgb(role: ColourRole): Rgb {
  return rgbVariable(ROLE_TOKEN[role], ROLE_RGB[role]);
}

function readTokens(): SceneTokens {
  const lightX = numberVariable("--shape-light-x", 0.32);
  const lightY = numberVariable("--shape-light-y", 0.24);

  return {
    highlight: rgbVariable("--shape-highlight", HIGHLIGHT_FALLBACK),
    shadow: rgbVariable("--shape-shadow", SHADOW_FALLBACK),
    // The CSS tokens place the highlight as a gradient origin measured from the
    // top-left, so 0.5 is centre and +y is DOWN. three.js is centre-origin with
    // +y UP. Rescaling and flipping is the whole conversion; getting the flip
    // wrong puts the key light under the floor and every form lights from below.
    lightDirection: new THREE.Vector3((lightX - 0.5) * 2, (0.5 - lightY) * 2, 1).normalize(),
    ambientIntensity: ambientIntensityFrom(numberVariable("--shape-ambient-opacity", 0.16)),
    // The CSS families describe how strong a highlight layer is over a shadow
    // layer. In PBR the same idea is roughness: a stronger highlight is a tighter
    // one, so roughness is 1 - highlight-opacity. Gloss additionally reads its
    // shadow layer as clearcoat roughness, which is what a clearcoat is for.
    matteRoughness: 1 - numberVariable("--shape-matte-highlight-opacity", 0.28),
    glossRoughness: 1 - numberVariable("--shape-gloss-highlight-opacity", 0.75),
    glossClearcoat: numberVariable("--shape-gloss-highlight-opacity", 0.75),
    glossClearcoatRoughness: numberVariable("--shape-gloss-shadow-opacity", 0.35),
    glassRoughness: 1 - numberVariable("--shape-glass-edge-opacity", 0.55),
    glassOpacity: numberVariable("--shape-glass-opacity", 0.42),
    floatPx: numberVariable("--shape-float-distance", 18),
    scaleFar: clamp(numberVariable("--shape-scale-far", 0.82), 0.2, 1),
    periodSeconds: Math.max(numberVariable("--duration-ambient", 9), 0.5),
  };
}

// ---------------------------------------------------------------------------
// Geometry and materials
// ---------------------------------------------------------------------------

/**
 * One geometry per 2D glyph, chosen so the SILHOUETTE matches `ShapeGlyph`.
 *
 * That is the whole reason these five and not five others. A sphere's outline is
 * a circle, a torus's is a ring, an octahedron's along an axis is a diamond, an
 * axis-aligned box's is a square, and a three-sided cone's is a triangle. The
 * legend a reader learns in the flat charts therefore still reads here, which is
 * what makes this the identity's shape family rather than a set of primitives
 * that happen to be 3D.
 *
 * Segment counts are halved on coarse pointers: a background layer at 40% opacity
 * does not need 28 width segments on a phone, and fill rate is the first thing to
 * hurt on integrated GPUs.
 */
function geometryFor(
  shape: HeroShapePlacement["shape"],
  radius: number,
  coarse: boolean,
): THREE.BufferGeometry {
  const detail = coarse ? 0.5 : 1;
  switch (shape) {
    case "circle":
      return new THREE.SphereGeometry(radius, Math.round(28 * detail), Math.round(18 * detail));
    case "ring":
      // Tube at 22% of the ring radius matches `ShapeGlyph`'s `strokeWidth={3}` on
      // an 8.5-unit circle — the same proportional weight, so the 3D ring and the
      // 2D one read as the same stroke.
      return new THREE.TorusGeometry(
        radius * 0.78,
        radius * 0.22,
        Math.round(14 * detail),
        Math.round(36 * detail),
      );
    case "diamond":
      return new THREE.OctahedronGeometry(radius, 0);
    case "square":
      // 1.7× so the box's silhouette matches the circle's apparent size. A box
      // inscribed in the same radius as a sphere looks visibly smaller, because
      // the sphere's outline passes through its extremes in every direction at
      // once and the box's only at four corners.
      return new THREE.BoxGeometry(radius * 1.7, radius * 1.7, radius * 1.7);
    case "triangle":
      // `thetaStart` puts a flat face toward the camera at spin 0, so the initial
      // silhouette is the glyph's triangle rather than a vertex pointing at us.
      return new THREE.ConeGeometry(radius * 1.15, radius * 1.9, 3, 1, false, Math.PI / 6);
  }
}

function materialFor(material: HeroMaterial, colour: Rgb, tokens: SceneTokens): THREE.Material {
  const base = new THREE.Color().setRGB(
    colour[0] / 255,
    colour[1] / 255,
    colour[2] / 255,
    THREE.SRGBColorSpace,
  );

  switch (material) {
    case "matte":
      return new THREE.MeshStandardMaterial({
        color: base,
        roughness: tokens.matteRoughness,
        // Metalness stays 0 across all three families. Doc 05 §2 warns against
        // making everything chrome or metallic, and metallic paints over the role
        // colour with the environment's — which would break the legend.
        metalness: 0,
      });
    case "gloss":
      return new THREE.MeshPhysicalMaterial({
        color: base,
        roughness: tokens.glossRoughness,
        metalness: 0,
        clearcoat: tokens.glossClearcoat,
        clearcoatRoughness: tokens.glossClearcoatRoughness,
      });
    case "glass":
      return new THREE.MeshPhysicalMaterial({
        color: base,
        roughness: tokens.glassRoughness,
        metalness: 0,
        // Real refraction (`transmission`) needs a transmission render target,
        // i.e. the scene drawn twice per frame, for a background layer nobody
        // inspects. Doc 05 §14 asks for 3D only where the result justifies the
        // complexity, so this is opacity instead — and `--shape-glass-opacity` is
        // the token that already says how see-through glass is in this system.
        // `--shape-glass-blur` has no equivalent without a post pass and is
        // deliberately not approximated.
        transparent: true,
        opacity: tokens.glassOpacity,
        side: THREE.DoubleSide,
        // Transparent forms must not write depth, or a near glass form hides
        // everything behind it despite being see-through.
        depthWrite: false,
      });
  }
}

/** Apply `--shape-scale-far`: the depth cue the 2D system uses for background forms. */
function depthScale(depth: number, scaleFar: number): number {
  return 1 - depth * (1 - scaleFar);
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Releases every GPU resource and listener the scene took. Idempotent. */
export type HeroSceneTeardown = () => void;

/**
 * Builds the scene on `canvas` and returns its teardown, or `null` if a WebGL
 * context could not be created.
 *
 * `null` rather than a throw because the caller's response is identical to "this
 * browser has no WebGL": render no field. The hero is still complete without it —
 * `HeroComposition` beside it is the evidence layer, and this is the identity
 * layer. Turning an ordinary capability gap into an exception would put it in
 * every error boundary on the page instead.
 */
export function createHeroScene(
  canvas: HTMLCanvasElement,
  placements: readonly HeroShapePlacement[],
): HeroSceneTeardown | null {
  // --- Parsed once per scene build --------------------------------------
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      // Transparent so the page's own surface shows through. A scene background
      // would be a second source of truth for the hero's ground colour, and
      // would not follow the theme.
      alpha: true,
      antialias: !coarsePointer.matches,
    });
  } catch {
    // Context creation can fail after a successful probe — too many live
    // contexts, a blocked GPU process, a driver deny-list.
    return null;
  }

  // No tone mapping. ACES would roll off the saturated role colours toward
  // white and shift their hue, and these colours are a legend, not a look.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  const group = new THREE.Group();
  scene.add(group);

  let tokens = readTokens();

  // --- Lights ------------------------------------------------------------
  const keyLight = new THREE.DirectionalLight(
    new THREE.Color().setRGB(1, 1, 1, THREE.SRGBColorSpace),
    KEY_INTENSITY,
  );
  // Navy fill from behind and below. It is what stops the shadow side of every
  // form going flat black, and it is the token's colour rather than a chosen
  // one, so the field's shadow side is the same navy the 2D shapes shade with.
  const fillLight = new THREE.DirectionalLight(
    new THREE.Color().setRGB(1, 1, 1, THREE.SRGBColorSpace),
    FILL_INTENSITY,
  );
  const ambientLight = new THREE.AmbientLight(
    new THREE.Color().setRGB(1, 1, 1, THREE.SRGBColorSpace),
    1,
  );
  scene.add(keyLight, fillLight, ambientLight);

  // --- Meshes ------------------------------------------------------------
  const meshes: THREE.Mesh[] = [];
  /** Per-form animation state, index-aligned with `meshes`. */
  const motion: Array<{ baseY: number; phase: number; spin: number; axis: "x" | "y" | "z" }> = [];
  /**
   * One geometry per GLYPH, shared by every form of that shape. Size is applied
   * through `mesh.scale` instead, so fifteen forms cost five buffers rather than
   * fifteen. Sharing is only safe because the scale is uniform — a non-uniform
   * one would skew the torus's tube against its ring and break the silhouette
   * match the whole family depends on.
   */
  const geometries = new Map<HeroShapePlacement["shape"], THREE.BufferGeometry>();
  /** Materials cannot be shared: each form carries its own role colour. */
  const materials: THREE.Material[] = [];

  for (const placement of placements) {
    let geometry = geometries.get(placement.shape);
    if (geometry === undefined) {
      geometry = geometryFor(placement.shape, BASE_RADIUS, coarsePointer.matches);
      geometries.set(placement.shape, geometry);
    }
    const material = materialFor(placement.material, roleRgb(placement.role), tokens);
    const mesh = new THREE.Mesh(geometry, material);

    group.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    motion.push({
      baseY: 0,
      phase: placement.phase,
      spin: placement.spin,
      axis: placement.spinAxis,
    });
  }

  // --- Sizing ------------------------------------------------------------
  /**
   * The float travel in world units, recomputed whenever the canvas is resized.
   *
   * It lives out here rather than in `layoutScene` because the frame loop reads
   * it every frame and must not re-derive it, and it is a world value rather than
   * the raw pixel token because `--shape-float-distance` is specified in CSS
   * pixels — converting it means the forms drift the same visible distance on a
   * phone and on a 4K monitor, instead of a fixed fraction of a scene whose
   * world size changes with the aspect ratio.
   */
  let floatWorld = 0;

  function layoutScene(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const coarse = coarsePointer.matches;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Half-extents of the frustum at z = 0. Mapping normalised u/v through
    // these is what makes the composition responsive without a second set of
    // numbers for mobile: the field always spans the same fraction of the hero.
    const halfHeight = Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180) * CAMERA_DISTANCE;
    const halfWidth = halfHeight * camera.aspect;
    // World units per CSS pixel at z = 0, so the pixel-denominated float token
    // converts. Local because nothing outside this function reads it.
    const worldPerPixel = (halfHeight * 2) / height;
    floatWorld = tokens.floatPx * worldPerPixel;

    const wide = camera.aspect > WIDE_ASPECT;
    const bias = wide ? WIDE_BIAS : 0;
    // Interpolated rather than switched, so dragging a window through the
    // breakpoint slides the composition outward instead of jumping.
    const narrowness = wide ? 0 : clamp((WIDE_ASPECT - camera.aspect) / WIDE_ASPECT, 0, 1);
    const uSpread = 1 + narrowness * (NARROW_SPREAD - 1);

    // Doc 05 §14: simplify on mobile. Visibility is toggled rather than the
    // scene rebuilt, so dragging a window across the breakpoint costs one loop.
    // Slicing from the front keeps the strongest forms, which `heroShapeLayout`
    // ranks first and places nearest the viewer.
    const visibleCount =
      coarse || width < 40 * 16
        ? Math.min(placements.length, HERO_SHAPE_LIMIT_COARSE)
        : placements.length;

    placements.forEach((placement, index) => {
      const mesh = meshes[index];
      if (mesh === undefined) return;
      mesh.visible = index < visibleCount;

      // The form's own weight and the depth cue multiply rather than add, so a
      // small far form stays small instead of being pushed back up to average.
      mesh.scale.setScalar(placement.scale * depthScale(placement.depth, tokens.scaleFar));
      mesh.position.set(
        (placement.u * uSpread * FIELD_SPREAD + bias) * halfWidth,
        placement.v * FIELD_SPREAD * halfHeight,
        -placement.depth * DEPTH_RANGE,
      );
      mesh.rotation.set(0, 0, 0);

      const state = motion[index];
      if (state !== undefined) {
        state.baseY = mesh.position.y;
        // Alternating forms float half a cycle apart. Without it the whole
        // field rises and falls together, which reads as the page breathing
        // rather than as depth.
        state.phase = placement.phase + (index % 2 === 0 ? 0 : Math.PI);
      }
    });
  }

  // --- Animation ---------------------------------------------------------
  let frame = 0;
  let running = false;
  let onScreen = true;
  const pointer = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };

  function renderFrame(elapsedSeconds: number): void {
    const angle = (elapsedSeconds / tokens.periodSeconds) * Math.PI * 2;

    meshes.forEach((mesh, index) => {
      if (!mesh.visible) return;
      const state = motion[index];
      if (state === undefined) return;

      if (!reducedMotion.matches) {
        mesh.position.y = state.baseY + Math.sin(angle + state.phase) * floatWorld;
        // Rotation is a pure function of elapsed time, not an increment per
        // frame. An increment makes the spin rate depend on the display's
        // refresh rate — a 144Hz screen would turn every form two and a half
        // times faster than a 60Hz one — and it accumulates drift across the
        // pause/resume cycles the visibility guards introduce.
        mesh.rotation[state.axis] = state.spin * elapsedSeconds;
      }
    });

    if (!reducedMotion.matches && !coarsePointer.matches) {
      pointer.x += (target.x - pointer.x) * PARALLAX_EASE;
      pointer.y += (target.y - pointer.y) * PARALLAX_EASE;
      group.rotation.y = pointer.x;
      group.rotation.x = pointer.y;
    }

    renderer.render(scene, camera);
  }

  let startedAt = 0;
  function tick(now: number): void {
    if (!running) return;
    if (startedAt === 0) startedAt = now;
    renderFrame((now - startedAt) / 1000);
    frame = window.requestAnimationFrame(tick);
  }

  function start(): void {
    if (running || reducedMotion.matches) return;
    running = true;
    frame = window.requestAnimationFrame(tick);
  }

  function stop(): void {
    running = false;
    if (frame !== 0) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  /**
   * The reduced-motion path: draw exactly one frame and never start a loop.
   *
   * Not "render nothing". Doc 05 §6 asks for a reduced alternative, not an
   * absent one, and a static composition of the same forms is a complete
   * picture — it is the motion that was the enhancement.
   *
   * At elapsed 0, which is deliberate: rotation is `spin * elapsed`, so every
   * form sits at its unrotated orientation and each silhouette is exactly the
   * 2D glyph it was chosen to match. The static frame is therefore the legend
   * itself, which is the most informative single frame available.
   */
  function renderStatic(): void {
    renderFrame(0);
  }

  function sync(): void {
    if (reducedMotion.matches) {
      stop();
      renderStatic();
    } else if (onScreen && !document.hidden) {
      start();
    } else {
      stop();
    }
  }

  // --- Observers ---------------------------------------------------------
  const resizeObserver = new ResizeObserver(() => {
    layoutScene();
    if (reducedMotion.matches) renderStatic();
  });
  resizeObserver.observe(canvas);

  // Doc 05 §14: pause ambient animation when content is outside the viewport.
  // The margin starts the loop again slightly early, so a form is never seen
  // mid-jump from its last animated position.
  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      onScreen = entry === undefined ? true : entry.isIntersecting;
      sync();
    },
    { rootMargin: "200px" },
  );
  intersectionObserver.observe(canvas);

  const visibilityListener = (): void => sync();
  document.addEventListener("visibilitychange", visibilityListener);

  const motionListener = (): void => {
    layoutScene();
    sync();
  };
  reducedMotion.addEventListener("change", motionListener);
  coarsePointer.addEventListener("change", motionListener);

  const pointerListener = (event: PointerEvent): void => {
    if (coarsePointer.matches) return;
    target.x = ((event.clientX / window.innerWidth) * 2 - 1) * PARALLAX_LIMIT;
    target.y = -((event.clientY / window.innerHeight) * 2 - 1) * PARALLAX_LIMIT;
  };
  window.addEventListener("pointermove", pointerListener, { passive: true });

  /**
   * Re-tint in place when the theme changes.
   *
   * Observing the attribute rather than subscribing to `ThemeProvider` keeps
   * this module unaware of how theming is implemented, and catches the boot
   * script's own `data-theme` write as well as a toggle. Without it the dark
   * theme gets light-theme forms, including a `--role-support` navy that is
   * near-invisible on the dark canvas.
   */
  function retint(): void {
    tokens = readTokens();
    const highlight = new THREE.Color().setRGB(
      tokens.highlight[0] / 255,
      tokens.highlight[1] / 255,
      tokens.highlight[2] / 255,
      THREE.SRGBColorSpace,
    );
    const shadow = new THREE.Color().setRGB(
      tokens.shadow[0] / 255,
      tokens.shadow[1] / 255,
      tokens.shadow[2] / 255,
      THREE.SRGBColorSpace,
    );

    keyLight.color.copy(highlight);
    keyLight.intensity = KEY_INTENSITY;
    keyLight.position.copy(tokens.lightDirection).multiplyScalar(8);

    fillLight.color.copy(shadow);
    fillLight.intensity = FILL_INTENSITY;
    fillLight.position.set(
      -tokens.lightDirection.x * 5,
      tokens.lightDirection.y * 2 - 3,
      -6,
    );

    ambientLight.color.copy(highlight);
    ambientLight.intensity = tokens.ambientIntensity;

    // Materials are re-read rather than patched from the old values, so a theme
    // that redefines a whole material family is honoured instead of half-applied.
    // The family comes from the placement, not from probing the material object:
    // `"clearcoat" in material` would work, but it makes the branch depend on
    // three.js's property set rather than on a decision this codebase made.
    placements.forEach((placement, index) => {
      const material = materials[index];
      if (material === undefined) return;
      const colour = roleRgb(placement.role);
      const standard = material as THREE.MeshStandardMaterial;
      standard.color.setRGB(
        colour[0] / 255,
        colour[1] / 255,
        colour[2] / 255,
        THREE.SRGBColorSpace,
      );

      switch (placement.material) {
        case "matte":
          standard.roughness = tokens.matteRoughness;
          break;
        case "gloss": {
          const physical = material as THREE.MeshPhysicalMaterial;
          physical.roughness = tokens.glossRoughness;
          physical.clearcoat = tokens.glossClearcoat;
          physical.clearcoatRoughness = tokens.glossClearcoatRoughness;
          break;
        }
        case "glass": {
          const physical = material as THREE.MeshPhysicalMaterial;
          physical.roughness = tokens.glassRoughness;
          physical.opacity = tokens.glassOpacity;
          break;
        }
      }
      material.needsUpdate = true;
    });

    layoutScene();
    if (reducedMotion.matches) renderStatic();
    else if (!running && onScreen && !document.hidden) renderer.render(scene, camera);
  }

  const themeObserver = new MutationObserver(() => retint());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });

  // --- Boot --------------------------------------------------------------
  retint();
  sync();

  // --- Teardown ----------------------------------------------------------
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;

    stop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    themeObserver.disconnect();
    document.removeEventListener("visibilitychange", visibilityListener);
    reducedMotion.removeEventListener("change", motionListener);
    coarsePointer.removeEventListener("change", motionListener);
    window.removeEventListener("pointermove", pointerListener);

    // Every geometry and material is released explicitly, and the shared
    // geometries are walked through the map rather than through the meshes —
    // disposing per-mesh would call `dispose()` on the same buffer up to fifteen
    // times. `renderer.dispose()` does not traverse the scene graph, so a hero
    // that skipped this would leak GPU memory on every client-side navigation.
    for (const geometry of geometries.values()) geometry.dispose();
    for (const material of materials) material.dispose();
    geometries.clear();
    scene.clear();
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      // Already gone. Nothing to recover, and throwing here would surface as an
      // unmount error on a component that is doing the right thing.
    }
  };
}
