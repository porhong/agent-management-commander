import { parse, stringify, TomlError } from 'smol-toml';
import { AmcError } from '@amc/core';

type Table = Record<string, unknown>;

const isTable = (v: unknown): boolean =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const isTableArray = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && v.every(isTable);

export function parseToml(text: string, source: string): Table {
  try {
    return parse(text) as Table;
  } catch (err) {
    const msg = err instanceof TomlError ? err.message.split('\n')[0] : (err as Error).message;
    throw new AmcError('NATIVE_PARSE_FAILED', `${source}: ${msg}`);
  }
}

const TAB = 0x09;
const LF = 0x0a;

/** A multi-line literal string keeps prompts readable; fall back to an escaped string if needed. */
function longString(value: string): string {
  // Literal strings can't hold ''' or control characters other than tab and newline.
  const hasControl = [...value].some((c) => {
    const code = c.charCodeAt(0);
    return (code < 0x20 && code !== TAB && code !== LF) || code === 0x7f;
  });
  const literalSafe = !value.includes("'''") && !hasControl;
  return literalSafe ? `'''\n${value}'''` : stringify({ v: value }).slice('v = '.length).trimEnd();
}

/**
 * Agent TOML with a stable layout: plain keys, then `developer_instructions` as a readable
 * multi-line string, then tables (`[mcp_servers.x]`, `[[skills.config]]`), which TOML requires last.
 */
export function stringifyAgentToml(data: Table, instructions: string): string {
  const plain: Table = {};
  const tables: Table = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    (isTable(v) || isTableArray(v) ? tables : plain)[k] = v;
  }
  const head = Object.keys(plain).length ? stringify(plain).trimEnd() + '\n' : '';
  const tail = Object.keys(tables).length ? '\n' + stringify(tables).trimEnd() + '\n' : '';
  return `${head}developer_instructions = ${longString(instructions)}\n${tail}`;
}
