import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FsPort } from '../fs/fs-port';
import { manifestSchemas, type ModeledKind } from '../model/manifests';
import { kindDir } from './item-io';

/** Absolute paths of the AMC home layout (docs/concept/05 §4). */
export interface AmcPaths {
  home: string;
  /** Source of truth; a git repo. */
  library: string;
  /** Rebuildable caches (index.sqlite), settings, targets, deploy journal. */
  state: string;
  snapshots: string;
  logs: string;
}

export const defaultAmcHome = (): string => join(homedir(), '.amc');

export function amcPaths(home: string = defaultAmcHome()): AmcPaths {
  return {
    home,
    library: join(home, 'library'),
    state: join(home, 'state'),
    snapshots: join(home, 'snapshots'),
    logs: join(home, 'logs'),
  };
}

/** Creates any missing folders of the AMC home. Idempotent; never touches existing content. */
export async function bootstrapHome(fs: FsPort, home?: string): Promise<AmcPaths> {
  const paths = amcPaths(home);
  for (const dir of [paths.library, paths.state, paths.snapshots, paths.logs]) {
    await fs.mkdirp(dir);
  }
  for (const kind of Object.keys(manifestSchemas) as ModeledKind[]) {
    await fs.mkdirp(join(paths.library, kindDir(kind)));
  }
  return paths;
}
