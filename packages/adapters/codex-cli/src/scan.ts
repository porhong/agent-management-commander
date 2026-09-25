import { join } from 'node:path';
import type { FsPort, NativeFile, NativeGroup, TargetRoots } from '@amc/core';
import { AGENTS_ROOT, CODEX_ROOT } from './mapping';

const isHidden = (rel: string) => rel.split('/').some((s) => s.startsWith('.'));

async function readFiles(fs: FsPort, root: string, relPaths: string[]): Promise<NativeFile[]> {
  return Promise.all(
    relPaths.map(async (relPath) => ({
      relPath,
      content: await fs.readFile(join(root, ...relPath.split('/'))),
    })),
  );
}

async function topLevelFiles(fs: FsPort, dir: string, ext: string): Promise<string[]> {
  if ((await fs.stat(dir))?.kind !== 'dir') return [];
  return (await fs.readdir(dir))
    .filter((e) => e.kind !== 'dir' && e.path.endsWith(ext) && !isHidden(e.path))
    .map((e) => e.path);
}

/**
 * Enumerates Codex items: agents (`<codex>/agents/*.toml`), custom prompts (`<codex>/prompts/*.md`,
 * global scope only), and skills (`<agents>/skills/<dir>/SKILL.md`). Read-only.
 */
export async function scanRoots(
  fs: FsPort,
  roots: TargetRoots,
  opts: { prompts: boolean },
): Promise<NativeGroup[]> {
  const groups: NativeGroup[] = [];
  const codex = roots[CODEX_ROOT]!;
  for (const f of await topLevelFiles(fs, join(codex, 'agents'), '.toml')) {
    const relPath = `agents/${f}`;
    groups.push({
      kind: 'agent',
      root: CODEX_ROOT,
      entry: relPath,
      files: await readFiles(fs, codex, [relPath]),
      linked: false,
    });
  }
  if (opts.prompts) {
    for (const f of await topLevelFiles(fs, join(codex, 'prompts'), '.md')) {
      const relPath = `prompts/${f}`;
      groups.push({
        kind: 'command',
        root: CODEX_ROOT,
        entry: relPath,
        files: await readFiles(fs, codex, [relPath]),
        linked: false,
      });
    }
  }

  const agentsHome = roots[AGENTS_ROOT]!;
  const skillsDir = join(agentsHome, 'skills');
  if ((await fs.stat(skillsDir))?.kind === 'dir') {
    for (const d of await fs.readdir(skillsDir)) {
      if (d.kind === 'file' || isHidden(d.path)) continue;
      // Symlinked/junctioned skill folders are followed for reading only.
      const skillDir = join(skillsDir, d.path);
      if (!(await fs.stat(join(skillDir, 'SKILL.md')))) continue;
      const rels = (await fs.readdir(skillDir, { recursive: true }))
        .filter((f) => f.kind === 'file' && !isHidden(f.path))
        .map((f) => `skills/${d.path}/${f.path}`);
      groups.push({
        kind: 'skill',
        root: AGENTS_ROOT,
        entry: `skills/${d.path}/SKILL.md`,
        files: await readFiles(fs, agentsHome, rels),
        linked: d.kind === 'symlink',
      });
    }
  }
  return groups;
}
