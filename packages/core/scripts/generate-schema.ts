// Regenerates packages/core/schema/*.json from the Zod manifest schemas.
// Run: bun run --filter @amc/core schema   (a test fails if the committed files are stale)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestJsonSchema } from '../src/model/json-schema';
import { manifestSchemas, type ModeledKind } from '../src/model/manifests';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
mkdirSync(outDir, { recursive: true });
for (const kind of Object.keys(manifestSchemas) as ModeledKind[]) {
  const file = join(outDir, `${kind}.amc.json`);
  writeFileSync(file, JSON.stringify(manifestJsonSchema(kind), null, 2) + '\n');
  console.log(`wrote ${file}`);
}
