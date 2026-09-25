import { describe, expect, it } from 'vitest';
import { cleanVersion } from './host';

describe('reading a tool version', () => {
  it('keeps the number and drops the tool name each CLI spells differently', () => {
    expect(cleanVersion('2.1.282 (Claude Code)\n')).toBe('2.1.282');
    expect(cleanVersion('codex-cli 0.156.1')).toBe('0.156.1');
    expect(cleanVersion('v1.2.3-beta.4')).toBe('1.2.3-beta.4');
    expect(cleanVersion('gemini 0.9')).toBe('0.9');
  });

  it('keeps the whole line when there is no number in it', () => {
    expect(cleanVersion('nightly build')).toBe('nightly build');
  });

  it('treats no output as no version', () => {
    expect(cleanVersion('   \n')).toBeNull();
  });
});
