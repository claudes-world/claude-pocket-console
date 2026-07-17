import { useRef } from "react";

/**
 * Shared-element FLIP morph: chips → list rows (WORLD-416 §2.4).
 *
 * On `begin()` every visible chip's label (mono name + status dot) is
 * measured (First), the mounted-but-hidden panel's row labels are measured
 * (Last), and a flying clone per session is created in the morph layer.
 * `apply(p)` interpolates everything linearly in p — scrub-safe by
 * construction — with transform/opacity only, on promoted layers:
 *
 *   - panel: translateY(-H → 0) inside an overflow:hidden wrapper
 *   - scrim: opacity p × 0.5 (flat rgba layer — no backdrop-filter, it's a
 *     frame-killer over the xterm canvas in iOS WebViews)
 *   - clones: translate(dx·p, dy·p) scale(1 → rowScale)
 *   - chip shells: fade out over p 0 → 0.4
 *   - row furniture (subtitle, badges, marks): fade in over p 0.5 → 1 with
 *     translateY(8px → 0), 12ms/row stagger capped at 5 rows
 *
 * Degrade rules (§2.4): `prefers-reduced-motion` → no FLIP, no slide, the
 * panel cross-fades in 120ms and nothing else animates. ≥ MAX_FLIP_SESSIONS
 * sessions → the panel still slides but no per-chip clones fly (measure
 * cost + layer count; 14 flying labels read as noise anyway). Chips
 * scrolled out of the strip's viewport never fly — their rows just fade in
 * with the furniture.
 *
 * One layout pass total, at `begin()` — never per frame. All writes go
 * through the single rAF writer that calls `apply(p)`.
 */

export const MAX_FLIP_SESSIONS = 14;

/** Fallback label scale when computed rects are degenerate (row 15px font
 *  over chip 11px ≈ 1.36). */
const DEFAULT_ROW_SCALE = 1.36;

export interface FlipTargets {
  /** chip button elements (shells that fade), keyed by session name */
  chipButtons: Map<string, HTMLElement>;
  /** the dot+name cluster inside each chip, keyed by session name */
  chipLabels: Map<string, HTMLElement>;
  /** the horizontal chip scroller (visibility window for clone eligibility) */
  chipStrip: HTMLElement | null;
  /** the dot+name cluster inside each panel row, keyed by session name */
  rowLabels: Map<string, HTMLElement>;
  /** per-row furniture nodes (subtitle, marks) that fade in late */
  rowFurniture: Map<string, HTMLElement[]>;
  /** displayed session order — stagger indices */
  rowOrder: string[];
  /** the translating panel content */
  panel: HTMLElement | null;
  /** the overflow:hidden reveal window around the panel */
  panelWrap: HTMLElement | null;
  scrim: HTMLElement | null;
  /** fixed, pointer-events:none overlay the clones fly in */
  morphLayer: HTMLElement | null;
}

interface FlyingClone {
  el: HTMLElement;
  dx: number;
  dy: number;
  scale: number;
  name: string;
}

export interface FlipMorph {
  /** Measure + build clones. Call with the panel mounted (hidden at p=0).
   *  Returns the degrade decision so the caller can pick durations. */
  begin(): { fadeOnly: boolean };
  /** Write every animated style for progress p. rAF-writer only. */
  apply(p: number): void;
  /** Tear down clones/will-change and pin final styles. */
  end(open: boolean): void;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createFlipMorph(getTargets: () => FlipTargets): FlipMorph {
  let t: FlipTargets | null = null;
  let clones: FlyingClone[] = [];
  /** rows whose label has no flying clone — the label fades with furniture */
  let fadingLabels: HTMLElement[] = [];
  let fadeOnly = false;
  let skipFlip = false;

  const furnitureFor = (name: string) => t?.rowFurniture.get(name) ?? [];

  return {
    begin() {
      t = getTargets();
      fadeOnly = prefersReducedMotion();
      skipFlip = fadeOnly || t.rowOrder.length >= MAX_FLIP_SESSIONS;
      clones = [];
      fadingLabels = [];

      if (fadeOnly) {
        // Cross-fade only: pin the panel at its resting transform once.
        if (t.panel) t.panel.style.transform = "translateY(0)";
        if (t.panelWrap) t.panelWrap.style.opacity = "0";
        return { fadeOnly };
      }

      const stripRect = t.chipStrip?.getBoundingClientRect() ?? null;

      // Measure Last rects at the panel's FINAL position: translate is
      // paint-only, so flipping the transform inside this JS frame causes
      // zero visible flashes — one extra rect read, no extra paint.
      const panel = t.panel;
      const prevTransform = panel?.style.transform ?? "";
      if (panel) panel.style.transform = "translateY(0)";

      if (!skipFlip && t.morphLayer) {
        for (const name of t.rowOrder) {
          const chipLabel = t.chipLabels.get(name);
          const rowLabel = t.rowLabels.get(name);
          if (!chipLabel || !rowLabel) continue;
          const first = chipLabel.getBoundingClientRect();
          const last = rowLabel.getBoundingClientRect();
          if (first.width === 0 || last.width === 0) continue;
          // Chips scrolled out of the strip don't fly (§2.4).
          if (stripRect && (first.right <= stripRect.left + 1 || first.left >= stripRect.right - 1)) continue;

          const clone = chipLabel.cloneNode(true) as HTMLElement;
          const cs = getComputedStyle(chipLabel);
          clone.style.position = "fixed";
          clone.style.left = `${first.left}px`;
          clone.style.top = `${first.top}px`;
          clone.style.margin = "0";
          clone.style.font = cs.font;
          clone.style.color = cs.color;
          clone.style.display = "inline-flex";
          clone.style.alignItems = "center";
          clone.style.gap = cs.gap;
          clone.style.whiteSpace = "nowrap";
          clone.style.pointerEvents = "none";
          clone.style.transformOrigin = "left center";
          clone.style.willChange = "transform";
          t.morphLayer.appendChild(clone);

          const rawScale = last.height / first.height;
          const scale = Number.isFinite(rawScale) && rawScale > 0.5 && rawScale < 3
            ? rawScale
            : DEFAULT_ROW_SCALE;
          clones.push({
            el: clone,
            dx: last.left - first.left,
            dy: (last.top + last.height / 2) - (first.top + first.height / 2),
            scale,
            name,
          });
          // The clone owns the label visual until settle.
          chipLabel.style.opacity = "0";
          rowLabel.style.opacity = "0";
        }
      }

      if (panel) panel.style.transform = prevTransform;

      const cloneNames = new Set(clones.map((c) => c.name));
      for (const name of t.rowOrder) {
        const rowLabel = t.rowLabels.get(name);
        if (rowLabel && !cloneNames.has(name)) fadingLabels.push(rowLabel);
      }

      // Promote animated layers for the transient only — leaving will-change
      // on permanently costs memory in the iOS WebView (§2.4).
      if (t.panel) t.panel.style.willChange = "transform";
      if (t.scrim) t.scrim.style.willChange = "opacity";
      for (const el of t.chipButtons.values()) el.style.willChange = "opacity";
      // Chips are display-only while the dock is not closed.
      if (t.chipStrip) t.chipStrip.style.pointerEvents = "none";

      return { fadeOnly };
    },

    apply(p) {
      if (!t) return;
      if (t.scrim) t.scrim.style.opacity = String(0.5 * clamp01(p));

      if (fadeOnly) {
        if (t.panelWrap) t.panelWrap.style.opacity = String(clamp01(p));
        return;
      }

      if (t.panel) t.panel.style.transform = `translateY(${(clamp01(p) - 1) * 100}%)`;

      const shellFade = 1 - clamp01(p / 0.4);
      for (const el of t.chipButtons.values()) el.style.opacity = String(shellFade);

      for (const c of clones) {
        c.el.style.transform =
          `translate(${c.dx * p}px, ${c.dy * p}px) scale(${1 + (c.scale - 1) * p})`;
        // Hand off to the real 15px row label exactly at settle so the text
        // lands crisp (the transient scales up an 11px raster).
        const settled = p >= 0.999;
        c.el.style.opacity = settled ? "0" : "1";
        const rowLabel = t.rowLabels.get(c.name);
        if (rowLabel) rowLabel.style.opacity = settled ? "1" : "0";
      }

      const targets = t;
      targets.rowOrder.forEach((name, i) => {
        // Furniture fades in over p 0.5→1, 12ms/row stagger ≈ 0.04 p-units,
        // capped at 5 staggered rows (§2.4).
        const offset = Math.min(i, 5) * 0.04;
        const f = clamp01((p - 0.5 - offset) / (0.5 - offset));
        const translate = `translateY(${8 * (1 - f)}px)`;
        for (const el of furnitureFor(name)) {
          el.style.opacity = String(f);
          el.style.transform = translate;
        }
        const rowLabel = targets.rowLabels.get(name);
        if (rowLabel && fadingLabels.includes(rowLabel)) {
          rowLabel.style.opacity = String(f);
          rowLabel.style.transform = translate;
        }
      });
    },

    end(open) {
      if (!t) return;
      for (const c of clones) c.el.remove();
      clones = [];

      // Restore chip internals; the shells' own opacity already encodes the
      // settled state (0 while open, 1 when closed re-settles).
      for (const el of t.chipLabels.values()) el.style.opacity = "";
      if (!open) {
        for (const el of t.chipButtons.values()) el.style.opacity = "";
        if (t.chipStrip) t.chipStrip.style.pointerEvents = "";
      }

      if (open) {
        // Pin the settled-open styles (the panel stays mounted).
        for (const label of t.rowLabels.values()) {
          label.style.opacity = "1";
          label.style.transform = "";
        }
        for (const els of t.rowFurniture.values()) {
          for (const el of els) {
            el.style.opacity = "1";
            el.style.transform = "";
          }
        }
        if (t.panel) t.panel.style.transform = "translateY(0)";
        if (t.panelWrap) t.panelWrap.style.opacity = "";
      }

      if (t.panel) t.panel.style.willChange = "";
      if (t.scrim) t.scrim.style.willChange = "";
      for (const el of t.chipButtons.values()) el.style.willChange = "";
      fadingLabels = [];
      t = null;
    },
  };
}

/** Hook wrapper: one stable FlipMorph per component instance. */
export function useFlipMorph(getTargets: () => FlipTargets): FlipMorph {
  const ref = useRef<FlipMorph | null>(null);
  const getTargetsRef = useRef(getTargets);
  getTargetsRef.current = getTargets;
  if (!ref.current) ref.current = createFlipMorph(() => getTargetsRef.current());
  return ref.current;
}
