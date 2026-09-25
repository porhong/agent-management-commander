import { describe, expect, it } from 'vitest';
import agentSchema from '../../../../../../packages/core/schema/agent.amc.json';
import commandSchema from '../../../../../../packages/core/schema/command.amc.json';
import skillSchema from '../../../../../../packages/core/schema/skill.amc.json';
import { EDITABLE_KINDS } from './kinds';
import { fieldsFor } from './manifest-fields';

/** The schemas the editor's hints describe, generated from the Zod manifests (P0-05). */
const SCHEMAS: Record<string, { properties: Record<string, unknown> }> = {
  agent: agentSchema,
  command: commandSchema,
  skill: skillSchema,
};

describe('manifest field hints', () => {
  it.each(EDITABLE_KINDS)('documents exactly the fields a %s manifest accepts', (kind) => {
    const documented = fieldsFor(kind)
      .map((f) => f.key)
      .sort();
    expect(documented).toEqual(Object.keys(SCHEMAS[kind]!.properties).sort());
  });

  it('gives every field a hint written for a person, not a type', () => {
    for (const kind of EDITABLE_KINDS) {
      for (const field of fieldsFor(kind)) {
        expect(field.hint.length, `${kind}.${field.key}`).toBeGreaterThan(10);
        expect(field.hint.endsWith('.'), `${kind}.${field.key}`).toBe(true);
      }
    }
  });
});
