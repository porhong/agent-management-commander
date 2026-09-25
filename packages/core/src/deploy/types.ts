import type { Adaptation, Target } from '../adapter/types';
import type { ItemId } from '../model/common';
import type { Issue } from '../validator/types';

// ---------- lockfile (T1.4.1) ----------

/** One file (or managed region) AMC owns in a target root. */
export interface LockEntry {
  itemId: ItemId;
  itemVersion: string;
  targetId: string;
  /** sha256 of the bytes AMC wrote (for a region: of its LF-normalized inner content). */
  sha256: string;
  deployedAt: string;
  /** The deploy that last wrote it; absent for files recorded by adopt. */
  deployId?: string;
}

/** `.amc-lock.json` in a target root (docs/concept/03 §5). */
export interface Lockfile {
  schemaVersion: 1;
  amcVersion: string;
  /** Whole files, keyed by `/`-separated path relative to the root. */
  files: Record<string, LockEntry>;
  /** Managed regions inside shared files: relPath → region id → entry. */
  regions: Record<string, Record<string, LockEntry>>;
}

// ---------- plan (T1.4.2–T1.4.4) ----------

export type Content = string | Buffer;

export type ConflictReason =
  /** A file AMC doesn't own sits where it wants to write. */
  | 'foreign'
  /** An owned file was edited outside AMC since the last deploy. */
  | 'drifted'
  /** The path resolves (through a symlink/junction) outside the target root. Never written. */
  | 'linked';

export type ConflictResolution =
  /** foreign: take ownership and overwrite (the old file is snapshotted). */
  | 'adopt-replace'
  /** foreign: move the existing file to `<name>.amc-backup[-n]`, then write. */
  | 'rename'
  /** drifted: discard the outside edit and write the library version. */
  | 'overwrite'
  | 'skip';

export type ChangeOp = 'create' | 'update' | 'delete' | 'unchanged';

interface ChangeBase {
  /** Stable id within the plan; conflict resolutions are keyed by it. */
  id: string;
  targetId: string;
  root: string;
  relPath: string;
  /** Set when the change is a managed region inside a shared file. */
  region?: string;
  itemId: ItemId;
  /** Current content (whole file, or region inner text); null when absent. */
  before: Content | null;
  /** Content after apply; null for deletes. For regions this is the region's inner text. */
  after: Content | null;
  adaptations: Adaptation[];
  /** Lock entry after apply; null removes it; undefined leaves the lockfile alone. */
  lock?: LockEntry | null;
}

export interface FileChange extends ChangeBase {
  op: ChangeOp;
  /** An unchanged foreign file that already matches: recorded as owned without writing. */
  adopt?: boolean;
}

export interface ConflictChange extends ChangeBase {
  op: 'conflict';
  reason: ConflictReason;
  /** What happens if the conflict is resolved by writing. */
  pending: 'create' | 'update' | 'delete';
  options: ConflictResolution[];
}

export type PlannedChange = FileChange | ConflictChange;

export interface TargetPlan {
  target: Target;
  targetId: string;
  /** Root key → absolute folder. */
  roots: Record<string, string>;
  /** `needs-attention` when a lockfile is corrupt: the target gets no changes at all. */
  status: 'ok' | 'needs-attention';
  message?: string;
  changes: PlannedChange[];
  /** Extra ownership changes applied verbatim (rollback restores prior entries this way). */
  lockUpdates?: LockUpdate[];
}

export interface LockUpdate {
  root: string;
  relPath: string;
  region?: string;
  entry: LockEntry | null;
}

export interface DeployPlan {
  planId: string;
  kind: 'deploy' | 'rollback';
  createdAt: string;
  /** For rollback plans: the deploy being reverted. */
  revertsDeployId?: string;
  targets: TargetPlan[];
  /** sha256 (or null when absent) of every file the plan looked at, lockfiles included. */
  readHashes: Record<string, string | null>;
  /** Validation results; blocking issues prevent apply. */
  issues: Issue[];
}

/** What a target should contain after the deploy: the full desired set, not a delta. */
export interface TargetSelection {
  target: Target;
  items: ItemId[];
}

// ---------- apply, journal, snapshots (T1.4.5–T1.4.7) ----------

export interface SnapshotEntry {
  /** Absolute path touched by the deploy. */
  path: string;
  targetId: string;
  root: string;
  relPath: string;
  /** Item that produced the file; absent for lockfiles. */
  itemId?: ItemId;
  /** False when the deploy created the file. */
  existed: boolean;
  /** Snapshot file name under `snapshots/<deployId>/before/`, when it existed. */
  beforeFile?: string;
  beforeSha?: string;
  /** Snapshot of what the deploy wrote, under `after/` (absent for deletes). */
  afterFile?: string;
  afterSha?: string;
}

export interface SnapshotManifest {
  deployId: string;
  planId: string;
  kind: 'deploy' | 'rollback';
  revertsDeployId?: string;
  createdAt: string;
  entries: SnapshotEntry[];
  /** Lock entries per change, so a rollback can restore ownership precisely. */
  locks: Array<{
    targetId: string;
    root: string;
    relPath: string;
    region?: string;
    before: LockEntry | null;
    after: LockEntry | null;
  }>;
}

export interface Journal {
  deployId: string;
  planId: string;
  startedAt: string;
  status: 'in-progress' | 'complete' | 'rolled-back';
  completedAt?: string;
}

/** Deployment rows for the index (T1.4.9): one per item per target. */
export interface DeploymentRecord {
  deployId: string;
  itemId: ItemId;
  itemVersion: string;
  targetId: string;
  files: string[];
  deployedAt: string;
}

export interface DeployReport {
  deployId: string;
  planId: string;
  written: string[];
  deleted: string[];
  skipped: string[];
  records: DeploymentRecord[];
}
