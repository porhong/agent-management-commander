import { CodeEditor } from '@/components/editor/code-editor';
import { estimateTokens } from './draft';
import type { EditableKind } from '@/lib/kinds';

/** What the body *is* differs per kind, and so does the file it lands in. */
export const BODY_LABEL: Record<EditableKind, { tab: string; file: string; hint: string }> = {
  skill: {
    tab: 'Instructions',
    file: 'SKILL.md',
    hint: 'What the tool should know or do when this skill is loaded.',
  },
  agent: {
    tab: 'Prompt',
    file: 'prompt.md',
    hint: 'The system prompt this agent runs with.',
  },
  command: {
    tab: 'Template',
    file: 'template.md',
    hint: 'The prompt sent when the command runs. Placeholders are filled in first.',
  },
};

export function BodyPane({
  kind,
  body,
  onChange,
}: {
  kind: EditableKind;
  body: string;
  onChange: (text: string) => void;
}) {
  const label = BODY_LABEL[kind] ?? BODY_LABEL.skill;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b bg-surface px-3 text-muted-foreground">
        <span className="id text-foreground">{label.file}</span>
        <span className="flex-1 truncate">{label.hint}</span>
        <span className="tabular-nums">~{estimateTokens(body).toLocaleString()} tokens</span>
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor
          value={body}
          onChange={onChange}
          language="markdown"
          label={`${label.tab}, as markdown`}
          placeholder={label.hint}
        />
      </div>
    </div>
  );
}
