import { join } from 'node:path';
import type { FsPort, NativeFile, NativeGroup } from '@amc/core';
import { ROOT } from './compile';

/** Skill folders managed by Claude itself (claude.ai sync). Never adopted or written. */
export const TOOL_MANAGED_SKILL_DIRS = new Set(['synced']);

const isHidden = (rel: string) => rel.split('/').some((s) => s.startsWith('.'));

async function exists(fs: FsPort, p: string) {
  return (await fs.stat(p)) !== null;
}

async function readFiles(fs: FsPort, root: string, relPaths: string[]): Promise<NativeFile[]> {
  return Promise.all(
    relPaths.map(async (relPath) => ({
      relPath,
      content: await fs.readFile(join(root, ...relPath.split('/'))),
    })),
  );
}

/** Enumerates agents, skills and commands under a Claude Code root (`~/.claude` or `.claude`). */
export async function scanRoot(fs: FsPort, root: string): Promise<NativeGroup[]> {
  const groups: NativeGroup[] = [];

  for (const kind of ['agent', 'command'] as const) {
    const dir = kind === 'agent' ? 'agents' : 'commands';
    if (!(await exists(fs, join(root, dir)))) continue;
    for (const e of await fs.readdir(join(root, dir), { recursive: true })) {
      if (e.kind !== 'file' || !e.path.endsWith('.md') || isHidden(e.path)) continue;
      const relPath = `${dir}/${e.path}`;
      groups.push({
        kind,
        root: ROOT,
        entry: relPath,
        files: await readFiles(fs, root, [relPath]),
        linked: false,
      });
    }
  }

  const skillsDir = join(root, 'skills');
  if (await exists(fs, skillsDir)) {
    for (const d of await fs.readdir(skillsDir)) {
      if (d.kind === 'file' || isHidden(d.path) || TOOL_MANAGED_SKILL_DIRS.has(d.path)) continue;
      // Junctions/symlinks (e.g. into ~/.agents/skills) are followed for reading only.
      const skillDir = join(skillsDir, d.path);
      if (!(await exists(fs, join(skillDir, 'SKILL.md')))) continue;
      const rels = (await fs.readdir(skillDir, { recursive: true }))
        .filter((f) => f.kind === 'file' && !isHidden(f.path))
        .map((f) => `skills/${d.path}/${f.path}`);
      groups.push({
        kind: 'skill',
        root: ROOT,
        entry: `skills/${d.path}/SKILL.md`,
        files: await readFiles(fs, root, rels),
        linked: d.kind === 'symlink',
      });
    }
  }
  return groups;
}
