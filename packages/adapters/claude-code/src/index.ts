import type { FsPort, ToolAdapter } from '@amc/core';
import { compileItem } from './compile';
import { ADAPTER_ID } from './mapping';
import { parseGroup } from './parse';
import { scanRoot } from './scan';

export { ADAPTER_ID as CLAUDE_CODE_ADAPTER_ID } from './mapping';
export { compileItem, parseGroup, scanRoot };
export type { ClaudeOverrides } from './parse';

export function createClaudeCodeAdapter(fs: FsPort): ToolAdapter {
  return {
    id: ADAPTER_ID,
    displayName: 'Claude Code',
    scan: (root) => scanRoot(fs, root),
    parse: parseGroup,
    compile: compileItem,
  };
}
