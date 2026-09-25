import { AmcError } from '../errors';
import type { ToolAdapter } from './types';

/** The set of adapters the app knows about, keyed by tool id. */
export class AdapterRegistry {
  private readonly adapters = new Map<string, ToolAdapter>();

  constructor(adapters: Iterable<ToolAdapter> = []) {
    for (const a of adapters) this.register(a);
  }

  register(adapter: ToolAdapter): this {
    if (this.adapters.has(adapter.id)) throw new Error(`Duplicate adapter: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(toolId: string): ToolAdapter {
    const a = this.adapters.get(toolId);
    if (!a) throw new AmcError('ADAPTER_NOT_FOUND', `No adapter for tool "${toolId}"`);
    return a;
  }

  has(toolId: string): boolean {
    return this.adapters.has(toolId);
  }

  list(): ToolAdapter[] {
    return [...this.adapters.values()];
  }

  /** Every adapter's per-target validator rules. */
  rules() {
    return this.list().flatMap((a) => a.rules);
  }
}
