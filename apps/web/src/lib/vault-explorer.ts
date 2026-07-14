export const VAULT_SCHEMA_VERSION = 1 as const;

export const PAGE_KINDS = [
  "index",
  "raw",
  "summary",
  "entity",
  "concept",
  "doctrine",
] as const;

export const FINDING_CATEGORIES = [
  "broken",
  "ambiguous",
  "orphan",
  "unreferenced_raw",
  "receipt",
] as const;

export type VaultPageKind = (typeof PAGE_KINDS)[number];
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export interface VaultPage {
  path: string;
  kind: VaultPageKind;
  title: string;
}

export interface VaultEdge {
  source: string;
  target: string;
  label: string | null;
  resolved: boolean;
  line: number;
}

export interface VaultFinding {
  category: string;
  path: string;
  reason: string;
  line?: number;
}

export type VaultFindings = Record<FindingCategory, VaultFinding[]>;
export type VaultCounts = Record<FindingCategory, number>;

export interface VaultIndex {
  index_schema_version: typeof VAULT_SCHEMA_VERSION;
  pages: VaultPage[];
  edges: VaultEdge[];
  findings: VaultFindings;
  counts: VaultCounts;
  status: "clean" | "findings";
  generated_at: string;
  vault: string;
}

export type VaultParseResult =
  | { ok: true; data: VaultIndex }
  | {
      ok: false;
      code: "invalid-json" | "unsupported-version" | "invalid-contract";
      message: string;
    };

export interface VaultPageGroups {
  index: VaultPage[];
  raw: VaultPage[];
  wiki: {
    concepts: VaultPage[];
    entities: VaultPage[];
    summaries: VaultPage[];
    other: VaultPage[];
  };
  doctrine: VaultPage[];
  armory: VaultPage[];
  other: VaultPage[];
}

export interface MappedFinding {
  finding: VaultFinding;
  page: VaultPage | null;
}

export type MappedFindings = Record<FindingCategory, MappedFinding[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLineNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function invalid(message: string): VaultParseResult {
  return { ok: false, code: "invalid-contract", message };
}

function parsePage(value: unknown, index: number): VaultPage | string {
  if (!isRecord(value)) return `pages[${index}] must be an object.`;
  if (typeof value.path !== "string") return `pages[${index}].path must be a string.`;
  if (!PAGE_KINDS.includes(value.kind as VaultPageKind)) {
    return `pages[${index}].kind is not supported.`;
  }
  if (typeof value.title !== "string") return `pages[${index}].title must be a string.`;
  return { path: value.path, kind: value.kind as VaultPageKind, title: value.title };
}

function parseEdge(value: unknown, index: number): VaultEdge | string {
  if (!isRecord(value)) return `edges[${index}] must be an object.`;
  if (typeof value.source !== "string") return `edges[${index}].source must be a string.`;
  if (typeof value.target !== "string") return `edges[${index}].target must be a string.`;
  if (value.label !== null && typeof value.label !== "string") {
    return `edges[${index}].label must be a string or null.`;
  }
  if (typeof value.resolved !== "boolean") return `edges[${index}].resolved must be a boolean.`;
  if (!isLineNumber(value.line)) return `edges[${index}].line must be a positive integer.`;
  return {
    source: value.source,
    target: value.target,
    label: value.label as string | null,
    resolved: value.resolved,
    line: value.line,
  };
}

function parseFinding(value: unknown, location: string): VaultFinding | string {
  if (!isRecord(value)) return `${location} must be an object.`;
  if (typeof value.category !== "string") return `${location}.category must be a string.`;
  if (typeof value.path !== "string") return `${location}.path must be a string.`;
  if (typeof value.reason !== "string") return `${location}.reason must be a string.`;
  if (value.line !== undefined && !isLineNumber(value.line)) {
    return `${location}.line must be a positive integer when present.`;
  }
  return {
    category: value.category,
    path: value.path,
    reason: value.reason,
    ...(value.line === undefined ? {} : { line: value.line }),
  };
}

export function parseVaultIndex(input: string | unknown): VaultParseResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return { ok: false, code: "invalid-json", message: "This is not valid JSON." };
    }
  }

  if (!isRecord(value)) return invalid("The link-check export must be a JSON object.");
  if (!("index_schema_version" in value)) {
    return invalid("The export is missing index_schema_version.");
  }
  if (value.index_schema_version !== VAULT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported-version",
      message: `Unsupported index schema version ${String(value.index_schema_version)}. This viewer supports version 1.`,
    };
  }

  if (!Array.isArray(value.pages)) return invalid("pages must be an array.");
  const pages: VaultPage[] = [];
  for (const [index, pageValue] of value.pages.entries()) {
    const page = parsePage(pageValue, index);
    if (typeof page === "string") return invalid(page);
    pages.push(page);
  }

  if (!Array.isArray(value.edges)) return invalid("edges must be an array.");
  const edges: VaultEdge[] = [];
  for (const [index, edgeValue] of value.edges.entries()) {
    const edge = parseEdge(edgeValue, index);
    if (typeof edge === "string") return invalid(edge);
    edges.push(edge);
  }

  if (!isRecord(value.findings)) return invalid("findings must be an object.");
  if (!isRecord(value.counts)) return invalid("counts must be an object.");

  const findings = {} as VaultFindings;
  const counts = {} as VaultCounts;
  for (const category of FINDING_CATEGORIES) {
    const categoryFindings = value.findings[category];
    if (!Array.isArray(categoryFindings)) return invalid(`findings.${category} must be an array.`);
    const parsedFindings: VaultFinding[] = [];
    for (const [index, findingValue] of categoryFindings.entries()) {
      const finding = parseFinding(findingValue, `findings.${category}[${index}]`);
      if (typeof finding === "string") return invalid(finding);
      parsedFindings.push(finding);
    }
    findings[category] = parsedFindings;

    const count = value.counts[category];
    if (!Number.isInteger(count) || (count as number) < 0) {
      return invalid(`counts.${category} must be a non-negative integer.`);
    }
    counts[category] = count as number;
  }

  if (value.status !== "clean" && value.status !== "findings") {
    return invalid('status must be either "clean" or "findings".');
  }
  if (typeof value.generated_at !== "string") return invalid("generated_at must be a string.");
  if (typeof value.vault !== "string") return invalid("vault must be a string.");

  return {
    ok: true,
    data: {
      index_schema_version: VAULT_SCHEMA_VERSION,
      pages,
      edges,
      findings,
      counts,
      status: value.status,
      generated_at: value.generated_at,
      vault: value.vault,
    },
  };
}

export function canonicalVaultPath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/^\//, "").replace(/\.md$/, "");
}

export function findPageByPath(pages: VaultPage[], path: string): VaultPage | null {
  const wanted = canonicalVaultPath(path);
  return pages.find((page) => canonicalVaultPath(page.path) === wanted) ?? null;
}

function sorted(pages: VaultPage[]): VaultPage[] {
  return [...pages].sort((a, b) => a.path.localeCompare(b.path));
}

export function groupVaultPages(pages: VaultPage[]): VaultPageGroups {
  const groups: VaultPageGroups = {
    index: [],
    raw: [],
    wiki: { concepts: [], entities: [], summaries: [], other: [] },
    doctrine: [],
    armory: [],
    other: [],
  };

  for (const page of pages) {
    const path = canonicalVaultPath(page.path);
    const segments = path.split("/");
    const top = segments[0];
    const second = segments[1];

    if (path === "index" || top === "index") groups.index.push(page);
    else if (top === "raw") groups.raw.push(page);
    else if (top === "wiki" && second === "concepts") groups.wiki.concepts.push(page);
    else if (top === "wiki" && second === "entities") groups.wiki.entities.push(page);
    else if (top === "wiki" && second === "summaries") groups.wiki.summaries.push(page);
    else if (top === "wiki") groups.wiki.other.push(page);
    else if (top === "doctrine") groups.doctrine.push(page);
    else if (top === "armory") groups.armory.push(page);
    else groups.other.push(page);
  }

  groups.index = sorted(groups.index);
  groups.raw = sorted(groups.raw);
  groups.wiki.concepts = sorted(groups.wiki.concepts);
  groups.wiki.entities = sorted(groups.wiki.entities);
  groups.wiki.summaries = sorted(groups.wiki.summaries);
  groups.wiki.other = sorted(groups.wiki.other);
  groups.doctrine = sorted(groups.doctrine);
  groups.armory = sorted(groups.armory);
  groups.other = sorted(groups.other);
  return groups;
}

export function getOutgoingEdges(page: VaultPage, edges: VaultEdge[]): VaultEdge[] {
  const source = canonicalVaultPath(page.path);
  return edges.filter((edge) => canonicalVaultPath(edge.source) === source);
}

export function getBacklinks(page: VaultPage, edges: VaultEdge[]): VaultEdge[] {
  const target = canonicalVaultPath(page.path);
  return edges.filter((edge) => canonicalVaultPath(edge.target) === target);
}

export function mapVaultFindings(index: VaultIndex): MappedFindings {
  const mapped = {} as MappedFindings;
  for (const category of FINDING_CATEGORIES) {
    mapped[category] = index.findings[category].map((finding) => ({
      finding,
      page: findPageByPath(index.pages, finding.path),
    }));
  }
  return mapped;
}
