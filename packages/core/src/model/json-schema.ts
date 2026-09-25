import { z } from 'zod';
import { manifestSchemas, type ModeledKind } from './manifests';

/**
 * JSON Schema for each manifest kind, used by the raw YAML editor for completion and hints
 * (M1.6). Generated from the input side so fields with defaults are optional. Zod refinements
 * (id prefix, duplicate args) are not representable and remain runtime-only checks.
 */
export function manifestJsonSchema(kind: ModeledKind): Record<string, unknown> {
  return {
    $id: `https://amc.dev/schema/${kind}.amc.json`,
    title: `AMC ${kind} manifest (amc.yaml)`,
    ...z.toJSONSchema(manifestSchemas[kind], { io: 'input', unrepresentable: 'any' }),
  };
}
