import type { FsPort } from '../fs/fs-port';
import type { LibraryItem } from '../library/item-io';
import type { ModeledKind } from '../model/manifests';
import type { ResolvedItem } from '../resolver/closure';
import type { Rule } from '../validator/types';

/** Adapter SDK (T1.3.1): the contract every tool adapter implements (docs/concept/03 §1). */

// ---------- targets (T1.3.7) ----------

/** Where items are deployed: a tool plus a scope. A project target is confined to its root. */
export type Target =
  { toolId: string; scope: 'global' } | { toolId: string; scope: 'project'; root: string };

export const targetId = (t: Target): string =>
  t.scope === 'global' ? `${t.toolId}:global` : `${t.toolId}:project:${t.root}`;

/**
 * Named folders a target writes into, e.g. Codex global uses `{ codex: ~/.codex, agents:
 * ~/.agents }`. Every compiled file names one of these keys; the deployer keeps one lockfile per
 * root and never writes outside it (S4).
 */
export type TargetRoots = Record<string, string>;

// ---------- host ----------

/** The outside world an adapter may look at. Injected so adapters are testable. */
export interface AdapterHost {
  fs: FsPort;
  /** The user's home directory. */
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Runs `cmd args…` and returns stdout, or null if it's missing, fails, or times out. */
  runVersion?: (cmd: string, args: string[]) => Promise<string | null>;
}

// ---------- detection & capabilities ----------

export interface DetectResult {
  /** True when the tool's config folder exists or its CLI answers. */
  installed: boolean;
  /** Trimmed output of `<cli> --version`, when the CLI is on PATH. */
  version?: string;
  /** Global roots, whether or not they exist yet. */
  roots: TargetRoots;
  notes: string[];
}

/** How well a tool supports a canonical feature (docs/concept/03 §3). */
export type Support = 'native' | 'degraded' | 'unsupported';

export interface CapabilityMatrix {
  skills: Support;
  agents: Support;
  commands: { global: Support; project: Support };
  /** Agent → skill with `mode: always`. */
  equipAlways: Support;
  /** Agent → skill with `mode: on-demand`. */
  equipOnDemand: Support;
  /** Command → agent. */
  commandAgent: Support;
  /** Command → preloaded skills. */
  commandPreload: Support;
  namedArgs: Support;
  agentTools: Support;
  skillTools: Support;
  modelHint: Support;
  skillScripts: Support;
}

// ---------- scan / parse ----------

/** A file inside a target root. `relPath` is `/`-separated and relative to that root. */
export interface NativeFile {
  relPath: string;
  content: Buffer;
}

/** Native files that together form one item (e.g. a skill folder), found by `scan`. */
export interface NativeGroup {
  kind: ModeledKind;
  /** Key into the target's roots. */
  root: string;
  /** Primary file, e.g. `agents/code-reviewer.md` or `skills/x/SKILL.md`. */
  entry: string;
  files: NativeFile[];
  /** True when reached through a symlink/junction: readable, but never written through. */
  linked: boolean;
}

export interface ParseResult {
  item: LibraryItem;
  /** Non-fatal notes, e.g. "name sanitized", "description missing, derived from body". */
  warnings: string[];
}

// ---------- compile ----------

/** A change the compiler made because the target lacks a feature. Always surfaced to users. */
export interface Adaptation {
  code: string;
  message: string;
}

export interface CompiledFile {
  /** Key into the target's roots. */
  root: string;
  relPath: string;
  content: string | Buffer;
  itemId: string;
  adaptations: Adaptation[];
  /**
   * Set for content that lives inside a shared file the user also edits (e.g. `AGENTS.md`).
   * `content` is then the region's inner text; the deployer splices it between
   * `<!-- amc:begin <region> -->` markers and leaves everything else untouched (T1.3.6, S7).
   */
  region?: string;
}

export interface ToolAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: CapabilityMatrix;
  /** Per-target validator rules (naming, description limits…). */
  readonly rules: readonly Rule[];
  detect(): Promise<DetectResult>;
  /** Root folders for a target. Project roots are always inside `target.root`. */
  paths(target: Target): TargetRoots;
  /** Enumerates native items in a target. Read-only. */
  scan(target: Target): Promise<NativeGroup[]>;
  /** Native files → canonical draft. Pure. */
  parse(group: NativeGroup, target: Target): ParseResult;
  /** Canonical item (with its references resolved) → native files. Pure and deterministic. */
  compile(item: ResolvedItem, target: Target): CompiledFile[];
}
