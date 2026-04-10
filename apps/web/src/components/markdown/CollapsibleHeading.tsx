/**
 * CollapsibleHeading — clickable heading that folds/unfolds its section.
 *
 * Renders a chevron (▶/▼) inline before the heading text. Clicking the
 * heading or chevron toggles the fold state of the associated section.
 *
 * First H1 is never collapsible (document title). Headings without a
 * data-has-section attribute (no content to fold) also skip the chevron.
 *
 * Accessibility:
 *  - role="button" + tabIndex on the heading for keyboard activation
 *  - aria-expanded reflects fold state
 *  - aria-controls points to the section element's id
 *  - Enter/Space toggle the fold
 */
import { type ReactNode, type KeyboardEvent, useCallback } from "react";

export interface FoldControls {
  foldedIds: Set<string>;
  toggleFold: (id: string) => void;
  /** Track first H1 to exclude it from collapsibility */
  isFirstH1: boolean;
}

interface HeadingProps {
  node?: any;
  children?: ReactNode;
  id?: string;
  [key: string]: any;
}

export function makeHeadingComponent(
  Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  controls: FoldControls,
) {
  const { foldedIds, toggleFold, isFirstH1 } = controls;

  return function CollapsibleHeading({
    node: _node,
    children,
    id,
    ...props
  }: HeadingProps) {
    const slug = typeof id === "string" ? id : "";
    const hasSection = props["data-has-section"] === "true";
    const isCollapsible =
      slug !== "" && hasSection && !(Tag === "h1" && isFirstH1);
    const folded = isCollapsible && foldedIds.has(slug);

    const handleClick = useCallback(() => {
      if (isCollapsible) toggleFold(slug);
    }, [isCollapsible, slug]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (isCollapsible && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggleFold(slug);
        }
      },
      [isCollapsible, slug],
    );

    // Strip data-has-section from rendered output
    const { "data-has-section": _, ...restProps } = props;

    if (!isCollapsible) {
      return (
        <Tag id={slug || undefined} {...restProps}>
          {children}
        </Tag>
      );
    }

    return (
      <Tag
        id={slug || undefined}
        {...restProps}
        role="button"
        tabIndex={0}
        aria-expanded={!folded}
        aria-controls={`section-${slug}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="cpc-collapsible-heading"
      >
        <span
          className="cpc-toggle-chevron"
          aria-hidden="true"
          data-folded={folded ? "true" : "false"}
        >
          {folded ? "\u25B6" : "\u25BC"}
        </span>
        {children}
      </Tag>
    );
  };
}
