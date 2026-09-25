import { useEffect, useRef } from 'react';
import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import {
  HighlightStyle,
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * The text editor used for bodies (markdown) and raw manifests (YAML).
 *
 * CodeMirror rather than Monaco (which the plan first named): Monaco puts its language services
 * in web workers, and this renderer is loaded from `file://` under `script-src 'self'`, where a
 * worker cannot be constructed. CodeMirror needs no worker, so highlighting and completion work
 * under the app's real CSP, and it costs a fraction of the bundle.
 */

/** Colours come from the app's tokens, so the editor follows the theme with no second palette. */
const highlight = HighlightStyle.define([
  { tag: [t.heading, t.strong], color: 'var(--foreground)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--kind-command)', textDecoration: 'underline' },
  { tag: [t.monospace, t.content], color: 'var(--foreground)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--kind-agent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--kind-skill)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--kind-workflow)' },
  { tag: [t.comment, t.quote], color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: [t.keyword, t.atom], color: 'var(--kind-command)' },
  { tag: t.invalid, color: 'var(--destructive)' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    fontSize: 'var(--text-sm)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--foreground)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
});

export type Language = 'markdown' | 'yaml';

const languageOf = (language: Language): Extension =>
  language === 'yaml' ? yaml() : markdown({ addKeymap: false });

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  /** Accessible name; the editor has no visible label of its own. */
  label: string;
  placeholder?: string;
  readOnly?: boolean;
  /** Schema-driven suggestions (T1.6.5). */
  completions?: CompletionSource;
}

export function CodeEditor({
  value,
  onChange,
  language,
  label,
  placeholder,
  readOnly = false,
  completions,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  // Held in refs so changing a callback never tears down and rebuilds the editor state.
  const emit = useRef(onChange);
  emit.current = onChange;
  const complete = useRef(completions);
  complete.current = completions;
  const editable = useRef(new Compartment());

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        bracketMatching(),
        indentUnit.of('  '),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        autocompletion({ override: [(ctx) => complete.current?.(ctx) ?? null] }),
        languageOf(language),
        syntaxHighlighting(highlight),
        theme,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        editable.current.of(EditorState.readOnly.of(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit.current(update.state.doc.toString());
        }),
      ],
    });
    const instance = new EditorView({ state, parent: host.current! });
    view.current = instance;
    return () => instance.destroy();
    // `value` is the initial document only; later changes are reconciled by the next effect.
  }, [language, label, placeholder]);

  // Reconciles an external change (revert, restore, switching back from raw mode) into the doc.
  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === value) return;
    instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  return <div ref={host} data-selectable className="h-full overflow-hidden" />;
}
