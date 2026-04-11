# CPC Plan: Markdown Renderer

## Phase 0: Baseline

### Fixture Corpus

#### Headings With Special Characters: `/files/:path?tab=docs`

##### Duplicate Heading

###### Tiny Detail

The smallest heading appears in some generated plans when a tool dumps nested
subsections.

## Phase 0: Baseline

The duplicate `h2` is intentional. Future heading IDs should make the duplicate
stable and reviewable rather than surprising.

### Fixture Corpus

Repeated `h3` content tests duplicate slug behavior once `rehype-slug` becomes
part of the renderer.

## Phase 1: Renderer Swap

### Keep `breaks: true`

The current marked configuration treats single newlines as breaks. The migration
must preserve that until a separate behavior-change PR says otherwise.

### Raw HTML Decision

#### `<details>` Blocks

Raw HTML occurs in docs copied from GitHub. This fixture keeps that input visible
in the baseline snapshots.

## Phase 2: Bundle Mitigation

### Lazy Loading

Bundle work belongs after correctness, so this fixture should not imply any
chunking change.

