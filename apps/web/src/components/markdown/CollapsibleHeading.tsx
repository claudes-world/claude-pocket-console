/**
 * CollapsibleHeading — clickable heading that folds/unfolds its section.
 *
 * Renders a chevron (▶/▼) inside an unstyled <button> nested within the
 * heading element, preserving the heading's semantic meaning for screen
 * readers (Finding 4 fix — role="button" on heading overrode semantics).
 *
 * First H1 is never collapsible (document title). Headings without a
 * data-has-section attribute (no content to fold) also skip the chevron.
 *
 * Each heading component registers itself via registerHeading during render,
 * so the parent can build the heading tree from rendered output instead of
 * fragile regex parsing (Finding 1 fix).
 *
 * Accessibility:
 *  - Nested <button> handles click/keyboard interaction
 *  - aria-expanded on the button reflects fold state
 *  - aria-controls points to the section element's id
 *  - Enter/Space activate the button natively
 */
import React, { type MutableRefObject, useCallback } from "react";
import type { ExtraProps } from "react-markdown";

export interface HeadingEntry {
  slug: string;
  level: number;
}

export interface FoldControls {
  foldedIds: Set<string>;
  toggleFold: (id: string) => void;
  /** Ref tracking the first H1 slug to exclude it from collapsibility */
  firstH1SlugRef: MutableRefObject<string | null>;
  /** Callback to register a heading entry during render */
  registerHeading: (entry: HeadingEntry) => void;
}

type HeadingProps = React.ComponentPropsWithoutRef<'h1'> & ExtraProps & { "data-has-section"?: string };

// Heading level from tag name (e.g. "h2" → 2)
function tagLevel(tag: string): number {
  return Number(tag[1]);
}

/**
 * Factory that creates a stable heading component for a given tag.
 * Called from useMemo in the parent — the returned component has a stable
 * identity between renders when fold state hasn't changed (Finding 2 fix).
 */
export function makeHeadingComponent(
  Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  controls: FoldControls,
) {
  const { foldedIds, toggleFold, firstH1SlugRef, registerHeading } = controls;
  const level = tagLevel(Tag);

  function CollapsibleHeading({
    node: _node,
    children,
    id,
    ...props
  }: HeadingProps) {
    const slug = typeof id === "string" ? id : "";

    // Register this heading for the heading tree (Finding 1 fix).
    // Safe to call during render — registerHeading appends to a ref
    // that is reset at the start of each render pass in the parent.
    if (slug) {
      registerHeading({ slug, level });
    }

    const hasSection = props["data-has-section"] === "true";
    const isFirstH1 = Tag === "h1" && slug === firstH1SlugRef.current;
    const isCollapsible =
      slug !== "" && hasSection && !isFirstH1;
    const folded = isCollapsible && foldedIds.has(slug);

    const handleClick = useCallback(() => {
      if (isCollapsible) toggleFold(slug);
    }, [isCollapsible, slug]);

    // Strip data-has-section from rendered output
    const { "data-has-section": _, ...restProps } = props;

    if (!isCollapsible) {
      return (
        <Tag id={slug || undefined} {...restProps}>
          {children}
        </Tag>
      );
    }

    // Finding 4 fix: use a nested <button> instead of role="button" on the
    // heading, so the heading retains its semantic meaning for screen readers.
    // The entire heading text is wrapped inside the button so that tapping
    // anywhere on the heading (not just the small chevron) toggles the fold.
    // This is critical for mobile UX where the chevron alone is too small.
    return (
      <Tag
        id={slug || undefined}
        {...restProps}
        className="cpc-collapsible-heading"
      >
        <button
          type="button"
          className="cpc-fold-btn"
          aria-expanded={!folded}
          aria-controls={`section-${slug}`}
          onClick={handleClick}
        >
          <span
            className="cpc-toggle-chevron"
            aria-hidden="true"
            data-folded={folded ? "true" : "false"}
          >
            {folded ? "\u25B6" : "\u25BC"}
          </span>
          <span className="cpc-fold-label">{children}</span>
        </button>
      </Tag>
    );
  }

  CollapsibleHeading.displayName = `CollapsibleHeading(${Tag})`;
  return CollapsibleHeading;
}
