import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/dialog';
import { FieldIssues } from './issues';
import { issuesFor, type TabProps } from './draft';

interface Argument {
  name: string;
  description?: string;
  required?: boolean;
  default?: string;
}

const read = (manifest: Record<string, unknown>): Argument[] =>
  Array.isArray(manifest['arguments']) ? (manifest['arguments'] as Argument[]) : [];

/**
 * A command's named arguments (T1.6.4). Named, because positional placeholders are 0-based in
 * Claude Code and 1-based here; the adapter reconciles that so the template never has to.
 */
export function ArgumentsTab({ draft, setManifest, setBody, issues }: TabProps) {
  const args = read(draft.manifest);
  const write = (next: Argument[]) => setManifest({ arguments: next });
  const patch = (index: number, fields: Partial<Argument>) =>
    write(args.map((a, i) => (i === index ? { ...a, ...fields } : a)));

  return (
    <div className="max-w-2xl p-4">
      <h2 className="font-medium">Arguments</h2>
      <p className="mt-1 text-muted-foreground">
        Each argument becomes a <span className="id">{'{{name}}'}</span> placeholder in the
        template. <span className="id">{'{{args}}'}</span> is everything the user typed, and{' '}
        <span className="id">{'{{arg1}}'}</span> is the first word.
      </p>

      {args.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          No arguments. The command runs on whatever the user types after its name.
        </p>
      ) : (
        <table className="mt-3 w-full">
          <thead>
            <tr className="h-7 border-b text-left text-xs font-medium text-muted-foreground">
              <th className="w-40">Name</th>
              <th>What it is</th>
              <th className="w-28">Default</th>
              <th className="w-20">Required</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {args.map((arg, index) => (
              <tr key={index} className="border-b border-border/50">
                <td className="py-1 pr-2">
                  <input
                    className={`${inputClass} id`}
                    aria-label={`Argument ${index + 1} name`}
                    value={arg.name ?? ''}
                    onChange={(e) => patch(index, { name: e.target.value })}
                    placeholder="pr"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    className={inputClass}
                    aria-label={`Argument ${index + 1} description`}
                    value={arg.description ?? ''}
                    onChange={(e) => patch(index, { description: e.target.value })}
                    placeholder="Pull request number or URL"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    className={inputClass}
                    aria-label={`Argument ${index + 1} default`}
                    value={arg.default ?? ''}
                    onChange={(e) => patch(index, { default: e.target.value })}
                  />
                </td>
                <td className="py-1 pr-2 text-center">
                  <input
                    type="checkbox"
                    className="check mx-auto"
                    aria-label={`Argument ${index + 1} is required`}
                    checked={arg.required === true}
                    onChange={(e) => patch(index, { required: e.target.checked })}
                  />
                </td>
                <td className="py-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove argument ${arg.name || index + 1}`}
                    onClick={() => write(args.filter((_, i) => i !== index))}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => write([...args, { name: '', required: false }])}
        >
          <Plus className="size-3.5" aria-hidden />
          Add argument
        </Button>
        {args.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setBody(
                `${draft.body}${draft.body.endsWith('\n') || draft.body === '' ? '' : '\n'}${args
                  .filter((a) => a.name)
                  .map((a) => `{{${a.name}}}`)
                  .join(' ')}\n`,
              )
            }
          >
            Insert placeholders into the template
          </Button>
        )}
      </div>

      <FieldIssues issues={issuesFor(issues, 'arguments')} />
    </div>
  );
}
