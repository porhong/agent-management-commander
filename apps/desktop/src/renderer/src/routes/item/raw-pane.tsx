import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { CodeEditor } from '@/components/editor/code-editor';
import { READ_ONLY_FIELDS, fieldsFor } from '@/lib/manifest-fields';
import type { EditableKind } from '@/lib/kinds';
import { BODY_LABEL } from './body-pane';

/** Suggests the keys this kind's manifest accepts, with what each one is for (T1.6.5). */
export function manifestCompletions(kind: EditableKind) {
  const fields = fieldsFor(kind);
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const typed = line.text.slice(0, ctx.pos - line.from);
    // Only top-level keys are documented, so only offer them at the start of a line.
    const match = /^([a-zA-Z]*)$/.exec(typed);
    if (!match) return null;
    const word = match[1]!;
    if (word.length === 0 && !ctx.explicit) return null;
    return {
      from: ctx.pos - word.length,
      options: fields.map((field) => ({
        label: field.key,
        type: 'property',
        detail: field.type,
        info: READ_ONLY_FIELDS.has(field.key) ? `${field.hint} Managed by AMC.` : field.hint,
        apply: `${field.key}: `,
      })),
      validFor: /^[a-zA-Z]*$/,
    };
  };
}

/**
 * Raw `amc.yaml` beside the body (T1.6.5). Edits here and in the form are the same draft, so
 * switching between them never loses anything; only unparseable YAML holds the switch back.
 */
export function RawPane({
  kind,
  yaml,
  body,
  error,
  onYamlChange,
  onBodyChange,
}: {
  kind: EditableKind;
  yaml: string;
  body: string;
  error: string | null;
  onYamlChange: (text: string) => void;
  onBodyChange: (text: string) => void;
}) {
  const completions = useMemo(() => manifestCompletions(kind), [kind]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-surface px-3">
        <span className="id">amc.yaml</span>
        <span className="text-muted-foreground">
          Ctrl+Space lists the fields this kind accepts.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={yaml}
          onChange={onYamlChange}
          language="yaml"
          label="Manifest, as YAML"
          completions={completions}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="flex shrink-0 gap-2 border-t bg-destructive/10 px-3 py-2 text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <div className="flex h-7 shrink-0 items-center border-y bg-surface px-3">
        <span className="id">{BODY_LABEL[kind]?.file ?? 'SKILL.md'}</span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={body}
          onChange={onBodyChange}
          language="markdown"
          label="Body, as markdown"
        />
      </div>
    </div>
  );
}
