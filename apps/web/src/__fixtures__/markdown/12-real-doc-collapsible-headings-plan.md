I have everything I need. Note that mermaid is not rendered interactively — there's no existing post-process pattern in MarkdownViewer using `createRoot`. Now I'll deliver the plan.

---

# Collapsible Heading Sections — Implementation Plan

**Date:** 2026-04-07
**Feature:** Disclosure triangles next to headings in the CPC markdown viewer that collapse/expand sections, with optional sync to a future TOC drawer.
**Note on file output:** This planning task is read-only — I cannot save the plan to `tmp/`. The full plan is below; copy/paste it wherever you'd like it to live.

---

## TL;DR

Add disclosure triangles next to every heading in `MarkdownViewer.tsx` so Liam can collapse long sections of a markdown doc. Use **Option A (DOM post-processing via ref)** because the existing component already uses `dangerouslySetInnerHTML`, the change is local, and we don't add a runtime dependency. Store fold state as a `Set<string>` of heading slugs in React state, **lifted to `App.tsx`** so a future `TocSheet` component can share it. Implement collapse via `display: none` on the DOM nodes between a heading and the next same-or-higher-level heading. **Effort: Medium — ~1 day standalone, ~1.5–2 days if shipped together with the TOC drawer (because heading-id assignment, the lift to `App.tsx`, and shared-state plumbing become a single coordinated PR).**

The biggest discovery during scouting: **marked v17 with `gfm: true` does NOT generate `id` attributes on headings.** The v17 default `heading` renderer is literally `` `<h${depth}>${parseInline(tokens)}</h${depth}>` `` (verified in `apps/web/node_modules/marked/lib/marked.esm.js` line 57). The existing TOC proposal (`tmp/20260407-markdown-toc-and-audio-proposals.md` line 71) is wrong about this. Both this feature and the TOC feature need to assign IDs themselves, which is one more reason to ship them together: they share that prep work.

---

## Part 1 — Current state scouting

### How markdown is rendered
- `apps/web/src/components/MarkdownViewer.tsx` calls `marked.parse(content)` inside a `useMemo`, then injects the result via `dangerouslySetInnerHTML` into a `<div className="md-content">`. The component is otherwise styles + HTML; it has **no ref, no post-processing, no event handlers**.
- `marked` is configured with `{ gfm: true, breaks: true }` only.
- The whole `.md-content` div lives inside an outer scrollable wrapper with `overflowY: auto`. Scroll position is managed by the browser.
- There's no virtual scrolling. Even very long docs render the entire DOM tree once.

### Heading IDs — the load-bearing finding
Marked v17's default renderer produces headings without `id` attributes. From `marked.esm.js`:
```
heading({tokens:e,depth:t}){return`<h${t}>${this.parser.parseInline(e)}</h${t}>\n`}
```
So today the rendered HTML for `## Hello world` is just `<h2>Hello world</h2>` — no anchor, no slug. Anything that needs to address headings (this feature, the TOC drawer, hash navigation) has to assign IDs after parse. That can be done either by:
- A custom marked renderer override (`marked.use({ renderer: { heading(...) {...} } })`) that emits `<h${depth} id="${slug}">...</h${depth}>`, with a small slugger that handles duplicates by appending `-2`, `-3`, etc.
- Or post-processing the DOM after the inner HTML is set, walking `h1...h6`, generating slugs from `textContent`, and assigning `el.id`.

The renderer-override approach is cleaner and the slug becomes part of the cached HTML (so it survives `useMemo` and stays stable across re-renders). I recommend that.

### How long docs are typically rendered
- No virtualization.
- `padding: "16px 16px"` outer wrapper, with the styled `<div class="md-content">` inside.
- All children of `.md-content` are immediate siblings produced by marked: `h1`, `h2`, `p`, `ul`, `pre`, `blockquote`, `hr`, `table`, etc. **This is critical for the collapse algorithm: section membership is determined by walking siblings, not descendants.**

### Parent component
- `FileViewer.tsx` hosts `<MarkdownViewer content={fileContent} fileName={fileName} />` only when `fileContent !== null && fileName.endsWith(".md")`.
- `FileViewer` already maintains a `collapsedRanges: Set<number>` state for **code-file line folding** (line 76). It's per-file (reset in `loadDirectory`/`loadFile`/`handleBack`). That's the right pattern to mirror for markdown fold state, but it should live higher (in `App.tsx`) so the TOC drawer can share it.

### Top-level state
- `App.tsx` already tracks `viewingFile: { path, name } | null` (line 47), which is the file currently open in the markdown viewer. That's the natural key for fold state.

### BottomSheet primitive
- `ActionBar.tsx` defines a local `BottomSheet` component (line 57) and uses it for ~10 modals already. The proposed TOC drawer would reuse it. Worth knowing because if/when the TOC ships, sync logic flows through whatever state lives in `App.tsx`.

---

## Part 2 — Design decisions

### 1. Triangle placement
- **Render position:** outside the heading text, in the left margin. Use a span/button with `position: absolute; left: -20px; top: 50%; transform: translateY(-50%)` against an `h1...h6 { position: relative; padding-left: 0 }`. The viewer's outer wrapper has `padding: "16px 16px"` so there's 16px of room before content clips — enough for a 14px triangle plus a couple of px breathing room. If clipping is a concern on very narrow Telegram screens, bump the wrapper padding-left to 24px and place the triangle at `left: -22px`.
- **Visual:** triangle character (▼ expanded, ▶ collapsed) at ~14px, color `#565f89` (matches the dim-text color used elsewhere). On hover/focus, brighten to `#7aa2f7`.
- **Hit area:** 32x32 transparent button centered on the triangle, so it's tappable on mobile. Use `padding` rather than width/height to keep visual size separate from hit area.
- **Default state:** all expanded. Liam can always tap to collapse, but a doc that opens half-folded is confusing.

### 2. What counts as a "section"
- An `h${N}` heading's section is **every sibling DOM node after it, up to (but not including) the next sibling that is `h1`...`h${N}`**. So an h2's section ends at the next h1 or h2; any h3/h4/h5/h6 in between belongs to the section.
- Nested triangles: a collapsed h2 hides everything after it including the h3 elements *and their triangles*. When the h2 expands again, those h3 triangles reappear in whatever state they were in before (if they were also collapsed, they stay collapsed). This falls out for free if the algorithm is just "set `display: none` on the contained DOM nodes" — re-expanding the parent restores the children's prior `display` state only if we're careful (see Part 4).
- **First H1 special case:** the top-level doc title (the first `h1` in the document) should NOT have a triangle. Collapsing it would hide everything. Detect by "first H1 in the rendered output" and skip it.
- **Empty section special case:** if the next sibling is already a heading of same/higher level (i.e. the section has zero non-heading content), don't show a triangle for that heading. It would be a no-op.

### 3. State storage
- `foldedSections: Set<string>` keyed by heading **slug** (not by index — slugs are stable across re-renders, indices aren't if the user scrolls and React re-mounts).
- **Per-file:** Reset whenever `viewingFile.path` changes. The simplest way is to key the state by file path: `foldedByFile: Map<string, Set<string>>`. Or even simpler: just drop the Set whenever `viewingFile.path` changes.
- **Persistence:** none. Ephemeral React state. Recreating fold state on revisit is cheap (one tap), and persisting it to localStorage for every doc Liam ever opens would create stale entries forever.
- **Where it lives:** Lift to `App.tsx`. Pass down to `MarkdownViewer` (which renders triangles + applies display: none) and to the future `TocSheet` (which renders the same fold indicators). See Part 5.

### 4. Animation
- **v1: instant.** No animation. `display: none` toggles immediately. Animating height is hard with `dangerouslySetInnerHTML` because we'd need to wrap each section in a div with a known height for max-height transitions, which means more DOM mutation.
- **v2 (defer):** if Liam asks for it, switch to wrapping each section in a `<div data-section-of="${slug}">` during post-processing and animate via `max-height` + `overflow: hidden`. Skip for v1.

### 5. Interaction with the TOC drawer
- **Tap heading in TOC → expand on the way:** When the user navigates to a heading, walk up its ancestor chain (h3 inside an h2 inside an h1) and remove all of those slugs from `foldedSections` before scrolling. This guarantees the target is visible.
- **TOC reflects collapse state:** TOC entries whose ancestor heading is collapsed should be visually de-emphasized (grey) and clicking them still works (it expands the ancestor first, then scrolls).
- **TOC has its own triangles:** Each parent heading row in the TOC gets its own little triangle that toggles the same `foldedSections` set. Tapping the triangle in the TOC collapses the section in the doc as well — they're literally the same state. This is the "sync" requirement and it falls out naturally if state is lifted.

### 6. Click target semantics
- Click triangle → toggle that section's slug in `foldedSections`.
- Click heading text → no-op. Don't toggle, don't scroll. Preserves text selection and the natural reading experience.
- (Optional, defer) Long-press heading → collapse all siblings of same level — "collapse all H2s" gesture. Not in v1.

---

## Part 3 — Technical approach

I evaluated all four options. **Recommend: Option A — post-process the rendered HTML via a ref**, with the small refinement that heading IDs are assigned by a custom marked renderer (not in the post-processing pass), so the slugs are stable and computed once.

### Option A — Post-process the rendered HTML (RECOMMENDED)
**How:** Keep `marked.parse` + `dangerouslySetInnerHTML` exactly as today. Add a `useRef<HTMLDivElement>` to the `.md-content` div. Add a `useLayoutEffect` that runs after each render: walk the children, find headings, compute each heading's section range (the sibling slice ending at the next same-or-higher heading), and:
1. Inject a triangle element (a `<button>` created with `document.createElement` is fine; no need for `createRoot` unless we want React to manage events) just before the heading text. Use event delegation on the wrapper div so we only attach one click listener total.
2. For each heading whose slug is in `foldedSections`, set `style.display = "none"` on every node in its section range.
3. For headings NOT in the set, ensure those nodes have their original display restored.

**Pros:**
- Zero new dependencies.
- Doesn't change the rendering pipeline.
- Easy to read and debug — the algorithm is one function.
- Handles the "first H1 = title, no triangle" case trivially.
- Heading-id assignment can be a one-line marked renderer override, decoupled from the fold logic.

**Cons:**
- Imperative DOM manipulation feels un-React-ish. Mitigate by keeping it in a single `useLayoutEffect` keyed on `[html, foldedSections]`.
- If marked re-runs and produces a new innerHTML, we re-walk the whole tree. That's fine — the doc isn't changing during fold/unfold, only fold state is.
- We have to remember the original `display` of each node we hide. Easiest: don't try to remember. Use a separate CSS class `.cpc-folded { display: none !important }` and toggle the class instead of inline styles. Then re-expanding just removes the class and the original display reappears. **This is the cleanest fix.**

### Option B — marked custom renderer + event delegation
**How:** `marked.use({ renderer: { heading({ tokens, depth }) { return `<h${depth} id="${slug}"><button class="cpc-toggle" data-slug="${slug}">▼</button>${parseInline(tokens)}</h${depth}>` } } })`. Then in MarkdownViewer, attach one click handler to the wrapper that listens for clicks on `.cpc-toggle`.

**Pros:**
- The triangle is part of the HTML — no second DOM walk to inject buttons.
- Handlers are attached via delegation so we still only have one listener.

**Cons:**
- The triangle is now inside the heading's text flow, not in the margin. To get it back to the margin we'd need absolute positioning anyway, which means CSS that depends on the heading being `position: relative`. Works, but uglier.
- Still need a separate post-processing pass to apply `display: none` based on fold state, because the renderer runs once at parse time and the fold state changes after.
- So Option B = Option A's complexity + a renderer override. No win.

### Option C — Switch to react-markdown
**How:** Replace marked with react-markdown. Headings become real React components that can have interactive children natively.

**Pros:**
- Idiomatic React. No imperative DOM work.
- `react-markdown` has a known plugin ecosystem (`rehype-slug` for IDs, `rehype-autolink-headings`, etc.).

**Cons:**
- New dependency (react-markdown + rehype + remark — meaningfully larger bundle, ~50–80KB minified depending on plugins).
- Existing styles, table handling, code blocks, GFM behavior all need to be re-verified.
- It's a much bigger PR with more risk for a feature that doesn't strictly require it.
- Doesn't solve the "section is the slice of siblings between headings" problem any better — react-markdown still produces a flat list of sibling elements at the top level. You still need to compute section ranges and conditionally hide them.

### Option D — Render token tree manually
**How:** Use marked's tokenizer to get the AST, then render to React elements ourselves.

**Pros:**
- Maximum control. Sections could be wrapped in real React components with proper conditional rendering.

**Cons:**
- Massive scope: re-implementing tables, code blocks, lists, blockquotes, GFM. The current viewer leans on marked's HTML output for all of this.
- This is not a one-day task. It's a rewrite.

### Recommendation
Go with **Option A**. The fold logic stays in one `useLayoutEffect` in `MarkdownViewer.tsx`. Heading IDs come from a marked renderer override (the only thing we change about the parse pipeline). Triangles are injected as plain DOM buttons; clicks are handled via event delegation. State lives in `App.tsx`. No new dependencies.

---

## Part 4 — The collapse mechanic

### Algorithm (sibling-slice walk)
After `marked.parse` runs and the HTML is in the DOM, in a `useLayoutEffect`:

1. Get a flat list of `.md-content`'s direct children: `const nodes = Array.from(rootRef.current.children)`. (They're already in document order — that's how marked emits them.)
2. Find headings: `const headings = nodes.filter(n => /^H[1-6]$/.test(n.tagName))`. Each heading remembers its index in `nodes` and its level (1–6, parsed from tagName).
3. Skip the first H1 (the doc title) — no triangle.
4. For every other heading at index `i` with level `L`:
   - Find the next heading at index `j > i` with level `<= L`. If none, `j = nodes.length`.
   - The section is `nodes.slice(i + 1, j)`.
   - If the section is empty (i.e. `j === i + 1` and the next thing is another heading), this heading is non-foldable: skip injecting a triangle for it.
   - Otherwise, inject a triangle button just before the heading's first child (or as a positioned-absolute child of the heading), with `data-slug="${heading.id}"`.
5. After triangles are injected, apply fold state: for each heading whose slug is in `foldedSections`, add `cpc-folded` class to every node in its section. This is what hides them. For each heading NOT in the set, remove the class from its section.
6. Update each triangle's text content: ▼ if expanded, ▶ if collapsed. Optional: append `(N)` where N is the count of non-empty paragraphs/elements in the section, so collapsed sections show "▶ (12)".

### Hide mechanism: a single CSS class
Add to the existing `<style>` block:
```css
.cpc-folded { display: none !important; }
.md-content h1, .md-content h2, .md-content h3,
.md-content h4, .md-content h5, .md-content h6 {
  position: relative;
}
.md-content .cpc-toggle {
  position: absolute;
  left: -22px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; color: #565f89;
  cursor: pointer; font-size: 14px;
  /* hit area extends past the visible 14px triangle */
}
.md-content .cpc-toggle:hover { color: #7aa2f7; }
```
Then `node.classList.add("cpc-folded")` / `removeAttribute("class")` is the entire collapse mechanic. We never touch `style.display`, so we never have to remember original display values. This cleanly handles `display: block`, `display: flex` (none of the markdown elements use it but defensively), `display: table` (for `<table>`), etc.

### Nested fold preservation
Because hidden ancestors don't run their own fold logic (we just `display: none` everything inside them), a collapsed h3 stays in `foldedSections` even when its parent h2 is also collapsed. When the h2 expands, the h3 remains collapsed because its slug is still in the set and the next post-process pass re-applies it. Exactly what we want.

### Click handling
Single delegated listener on `rootRef.current`:
```ts
const onClick = (e: MouseEvent) => {
  const btn = (e.target as HTMLElement).closest('.cpc-toggle');
  if (!btn) return;
  const slug = btn.getAttribute('data-slug');
  if (!slug) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFold(slug);
};
```
Where `toggleFold` is a callback passed from `App.tsx` (or `FileViewer`) that updates `foldedSections`.

---

## Part 5 — TOC sync strategy

### State management — recommendation
**Lift to `App.tsx`.** Add:
```ts
const [foldedSections, setFoldedSections] = useState<Set<string>>(new Set());

// Reset whenever the viewing file changes
useEffect(() => { setFoldedSections(new Set()); }, [viewingFile?.path]);

const toggleFold = useCallback((slug: string) => {
  setFoldedSections(prev => {
    const next = new Set(prev);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
  });
}, []);

const expandAncestors = useCallback((slugs: string[]) => {
  setFoldedSections(prev => {
    const next = new Set(prev);
    for (const s of slugs) next.delete(s);
    return next;
  });
}, []);
```

Pass `foldedSections`, `toggleFold`, `expandAncestors` down to `FileViewer` → `MarkdownViewer`, and (when it ships) to `TocSheet`.

### Why not React Context?
- Only 2 components need this state. Prop drilling through `FileViewer → MarkdownViewer` is one hop.
- Context invalidates everything in its tree on every change, causing the whole `FileViewer` to re-render on every fold toggle. Not catastrophic but unnecessary.
- Explicit props are easier to reason about and easier to remove later if Liam decides he hates this feature.

### Why not a custom event bus?
- The "shared state" requirement is the whole point. Event buses recreate state by accident and lose it on re-mount. React state is the right tool.

### Sync flow when TOC ships
1. `TocSheet` parses the headings from the rendered markdown (or receives them as a prop from `MarkdownViewer`, which is cleaner — see "shared headings list" below).
2. Each parent heading row in TocSheet has a triangle that calls `toggleFold(slug)`.
3. Each leaf row that's an ancestor-of-folded shows greyed out.
4. When a row is tapped, TocSheet computes the chain of ancestors (walks up the parsed-headings list to find every heading at a higher level whose section contains this slug), calls `expandAncestors(ancestors)`, and then triggers a smooth scroll to the slug's element. Both sides of the sync share the same `Set`, so the doc reflects the change automatically via `MarkdownViewer`'s `useLayoutEffect`.

### Shared headings list
To avoid parsing headings twice (once in `MarkdownViewer` for triangles, once in `TocSheet` for the list), have `MarkdownViewer` parse headings during its `useLayoutEffect`, store them in a state variable, and pass them up via an `onHeadingsChange?: (headings: Heading[]) => void` callback. `App.tsx` holds the headings array and passes it into `TocSheet`. This is the same pattern as `onViewChange` already used in `FileViewer.tsx` (line 154).

---

## Part 6 — Edge cases

| Case | Behavior |
|------|----------|
| Doc has zero headings | No triangles render. Loop in post-process finds no headings; nothing happens. |
| First H1 = doc title | Skip injecting triangle for it. Detected as "first heading in document order at level 1". |
| Heading with no content after it (just another heading) | Section range is empty. Don't inject triangle. The heading still gets an `id` (for TOC linking) but no fold control. |
| Heading is the very last element | Section is `nodes.slice(i+1, nodes.length)`, which may be empty (no triangle) or contain trailing content. |
| Two headings with the same text | Slugger appends `-2`, `-3`, etc. for uniqueness. Standard slug behavior. |
| Markdown contains raw HTML headings (`<h2>...</h2>` typed by user) | Marked passes them through if `gfm` mode allows. They become real `<h2>` elements in the output and get triangles like any other heading. |
| User collapses a section, then scrolls | No issue. Browser preserves scroll position relative to the document, and when content above the viewport disappears, the scroll position adjusts naturally. (If this looks jumpy in practice, we can record `scrollTop` before the toggle and restore it after — but try without first.) |
| User switches files | `useEffect([viewingFile.path])` resets `foldedSections` to empty. Fresh slate per file. |
| User collapses an H2, then collapses its parent H1 | Both slugs are in the set. The H1's hide-pass hides the H2 and everything inside it (the H2's triangle is hidden along with the rest). When the user re-expands the H1, the H2 is still in the set so it stays collapsed and shows ▶. |
| Hash navigation `#some-heading` | Browser scrolls to the element. If that element is inside a collapsed section, it won't be visible. Solution: on mount and on hash change, walk up from the target heading to find any folded ancestors and remove them. Same `expandAncestors` helper TocSheet uses. |
| Triangle click also bubbles to heading | The delegated handler calls `e.preventDefault()` and `e.stopPropagation()`. Heading text click does nothing anyway. |
| Marked renderer override breaks something | Run the existing markdown viewer manually with several test docs (long ADRs, the overnight reports, code-heavy files) to confirm output is unchanged except for the new `id` attributes. |

---

## Part 7 — Scope and effort

### Standalone (no TOC)
**Medium — about 1 day (6–8 hours).**

Breakdown:
- 1h: marked renderer override + slugger utility
- 2h: post-processing logic in `MarkdownViewer` (sibling walk, triangle injection, fold application)
- 1h: lift fold state to `App.tsx`, prop-drill through `FileViewer`
- 1h: CSS, visual polish, mobile hit-area testing
- 1h: edge cases (first H1, empty sections, hash navigation)
- 1h: manual testing on real docs (overnight reports, ADRs, long synthesis docs)

### With TOC sync (if TOC ships in the same PR or right after)
**Medium-large — about 1.5–2 days.**

The TOC drawer itself is independently estimated at 4–6 hours in the existing proposal, but it shares a bunch of work with this feature:
- Heading-ID assignment (do it once in the marked renderer override — both features benefit)
- Heading parsing (do it once in `MarkdownViewer`, hand the list up via `onHeadingsChange`)
- Lifted fold state in `App.tsx` (one `useState`)

Combined effort:
- 6–8h: collapsible headings (above)
- 4–6h: TOC drawer
- 2–3h: shared-state plumbing (foldedSections + headings list flowing through both components, the expand-ancestors-on-tap logic, greyed-out leaf rendering)
- Total: ~12–17h, call it 1.5–2 days

Strong recommendation: **ship them together as one PR** if both are wanted. The shared work (renderer override, heading parsing, lifted state) is half the value, and doing them in two separate PRs duplicates the prep and risks divergent slug schemes.

---

## Open questions

1. **Triangle character or SVG?** Character (▼/▶) is simplest and matches the existing emoji-heavy visual style of the file viewer (📁/📄). SVG would be sharper but adds icon-system overhead. Recommend character for v1.
2. **Show item count when collapsed?** "▶ (12 items)" is informative but adds clutter. Recommend: skip for v1, add if Liam asks.
3. **Should the H1 doc title be stylable separately?** The "skip triangle on first H1" rule is content-agnostic — it's positional. If Liam writes a doc that doesn't start with an H1, the first H2 still gets a triangle. Confirm this is fine.
4. **Per-file persistence?** The recommendation is no persistence. If Liam routinely re-opens the same long doc (an ADR he's reviewing for a week), a localStorage cache keyed by `file path → Set<slug>` would be a small addition. Defer until requested.
5. **Markdown re-render churn:** the `useMemo` keys on `[content]`, so toggling fold state doesn't re-parse markdown. Triangles persist, fold logic just toggles classes. Confirmed safe.
6. **Does the existing TOC proposal's effort estimate need updating?** Yes — the proposal claims marked already generates IDs (`tmp/20260407-markdown-toc-and-audio-proposals.md` line 71). It doesn't. Add ~30 minutes to the TOC estimate for the renderer override + slugger.
7. **Telegram WebApp viewport quirks:** the markdown viewer is inside a Telegram mini app. Triangles positioned absolutely with `left: -22px` need to not get clipped by the outer scrollable container's overflow rules. The current outer wrapper has `overflowX: "auto"` (line 25) — this is fine because the triangles are still inside `.md-content` which has `padding: 16px 16px` (line 23). The 16px of left padding is enough room. Verify on a narrow device.
8. **Accessibility:** the triangle button needs `aria-expanded={!folded}`, `aria-controls={sectionId}`, and a screen-reader label like `aria-label="Collapse section: {heading text}"`. Add this in v1; it's cheap.

---

## Phased implementation plan

### Phase 0 — Prep (do this first)
1. Add a slug helper in `MarkdownViewer.tsx` (or a new `lib/slug.ts` if you prefer): `function slugify(text: string, used: Set<string>): string` that lowercases, strips punctuation, replaces whitespace with `-`, and appends `-2`, `-3` for duplicates.
2. Override marked's heading renderer:
   ```ts
   const slugCounts = new Map<string, number>();
   marked.use({
     renderer: {
       heading({ tokens, depth }) {
         const text = this.parser.parseInline(tokens);
         const plain = text.replace(/<[^>]*>/g, '');  // strip inline HTML for slug
         const base = slugify(plain);
         const n = (slugCounts.get(base) ?? 0) + 1;
         slugCounts.set(base, n);
         const slug = n === 1 ? base : `${base}-${n}`;
         return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
       }
     }
   });
   ```
   Important: reset `slugCounts` per `marked.parse` call. Cleanest way: build the override inside the `useMemo` so each parse call gets a fresh Map. Or use a `marked.use` extension hook. (The simplest pattern: declare a renderer object once at module scope but reset its `slugCounts` Map at the start of each `useMemo` body — slightly hacky. The extension hook is cleaner; if it's too fiddly, just call `marked.use` once per parse, which works because `marked.use` is idempotent for renderer overrides.)

### Phase 1 — Visual triangles, no logic
1. Add `cpc-toggle` and `cpc-folded` CSS to `MarkdownViewer`'s `<style>` block.
2. Add a `useLayoutEffect` that walks `.md-content` children, finds headings, and injects a triangle button before each heading's content. Skip the first H1.
3. Verify visually: triangles appear in the left margin of every heading except the doc title.
4. No fold logic yet. Triangles are inert.

### Phase 2 — Fold logic locally in MarkdownViewer
1. Add local `useState<Set<string>>` for fold state inside `MarkdownViewer` temporarily.
2. Compute section ranges (sibling slice between headings) for each heading.
3. Apply `cpc-folded` class to all nodes in the range when the heading's slug is in the set.
4. Wire up the delegated click handler so triangles toggle.
5. Test: collapse h2, collapse nested h3, expand parent h2, confirm h3 stays collapsed.
6. Test edge cases: first H1, empty sections, last heading.

### Phase 3 — Lift state to App.tsx
1. Move `foldedSections`, `toggleFold` from `MarkdownViewer` to `App.tsx`.
2. Add `useEffect([viewingFile?.path])` reset.
3. Pass through `FileViewer` as props, then to `MarkdownViewer`.
4. Verify: switching files resets fold state. Switching tabs and back preserves it (unless file changed).

### Phase 4 — Polish
1. Add `aria-expanded`, `aria-controls`, `aria-label` to triangle buttons.
2. Test mobile hit area on a real device or browser devtools touch simulator.
3. Test with the longest markdown docs you can find (overnight reports, ADRs).
4. Verify hash navigation: `#some-heading-inside-folded-section` should auto-expand ancestors. Add `expandAncestors` walker if not done in Phase 3.

### Phase 5 — TOC sync (only if TOC drawer is in scope)
1. Add `headings: Heading[]` state in `App.tsx`.
2. Add `onHeadingsChange` callback in `MarkdownViewer`, fire it from the same `useLayoutEffect` that builds triangles.
3. Implement `TocSheet` per the existing proposal, but pass it `foldedSections`, `toggleFold`, and `headings`.
4. In TocSheet, render parent rows with triangles and leaf rows greyed out when an ancestor is folded.
5. On row tap: compute ancestor slugs, call `expandAncestors`, scroll to slug.
6. Test the round trip: collapse h2 in doc → its h3 children grey out in TOC. Tap an h3 in TOC → ancestor h2 expands in doc → scroll lands on h3.

### Phase 6 — (Defer) Animation
Wrap each section in a data-attributed div during post-processing, animate via max-height + overflow. Only do this if Liam asks.

---

## Critical Files for Implementation

- `/home/claude/code/claude-pocket-console/apps/web/src/components/MarkdownViewer.tsx` — primary changes: add ref, useLayoutEffect for triangle injection + fold application, marked renderer override for heading IDs, CSS for `.cpc-toggle` and `.cpc-folded`. Receives `foldedSections` and `toggleFold` as props.
- `/home/claude/code/claude-pocket-console/apps/web/src/App.tsx` — add `foldedSections: Set<string>` state, `toggleFold` and `expandAncestors` callbacks, reset effect on `viewingFile.path` change. Pass props down through `FileViewer`.
- `/home/claude/code/claude-pocket-console/apps/web/src/components/FileViewer.tsx` — add prop pass-through for fold state and callbacks; otherwise unchanged. (Already manages its own `collapsedRanges` for code-file folding — that stays separate; markdown fold is a different feature that lives at App level.)
- `/home/claude/code/claude-pocket-console/apps/web/src/components/ActionBar.tsx` — only relevant if TOC drawer ships in the same pass. Reference for the existing `BottomSheet` component that the future `TocSheet` should reuse.
- `/home/claude/claudes-world/tmp/20260407-markdown-toc-and-audio-proposals.md` — the related TOC proposal. Note that its claim about marked auto-generating IDs is incorrect; if both features ship, they share the heading-id assignment work described here.