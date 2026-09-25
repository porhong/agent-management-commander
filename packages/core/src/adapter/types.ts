import type { LibraryItem } from '../library/item-io';
import type { ModeledKind } from '../model/manifests';

/**
 * Adapter SDK — Phase 0 draft. Grows into the full ToolAdapter interface in M1.3 (T1.3.1):
 * detect / capabilities / paths / scan / compile / parse (docs/concept/03 §1).
 */

/** A file inside a target root. `relPath` is `/`-separated and relative to the root. */
export interface NativeFile {
  relPath: string;
  content: Buffer;
}

/** Native files that together form one item (e.g. a skill folder), found by `scan`. */
export interface NativeGroup {
  kind: ModeledKind;
  /** Primary file, e.g. `agents/code-reviewer.md` or `skills/x/SKILL.md`. */
  entry: string;
  files: NativeFile[];
  /** True when reached through a symlink/junction: readable, but never written through. */
  linked: boolean;
}

/** A change the compiler made because the target lacks a feature. Always surfaced to users. */
export interface Adaptation {
  code: string;
  message: string;
}

export interface CompiledFile {
  relPath: string;
  content: string | Buffer;
  itemId: string;
  adaptations: Adaptation[];
}

export interface ParseResult {
  item: LibraryItem;
  /** Non-fatal notes, e.g. "name sanitized", "description missing, derived from body". */
  warnings: string[];
}

export interface ToolAdapter {
  readonly id: string;
  readonly displayName: string;
  scan(root: string): Promise<NativeGroup[]>;
  parse(group: NativeGroup): ParseResult;
  compile(item: LibraryItem): CompiledFile[];
}
