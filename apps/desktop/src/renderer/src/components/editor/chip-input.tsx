import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { inputClass } from '@/components/ui/dialog';

/**
 * A list of short values — tags, permissions — entered one at a time. Chips rather than a
 * comma-separated box, so a value with punctuation (`shell:readonly`, `mcp:github`) is
 * unambiguous.
 */
export function ChipInput({
  value,
  onChange,
  label,
  placeholder,
  suggestions = [],
  chipClass = 'bg-secondary text-secondary-foreground',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  placeholder?: string;
  suggestions?: { value: string; hint: string }[];
  chipClass?: string;
}) {
  const [text, setText] = useState('');
  const listId = useId();

  const add = (raw: string) => {
    const next = raw.trim();
    if (!next || value.includes(next)) return setText('');
    onChange([...value, next]);
    setText('');
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((entry) => (
          <span
            key={entry}
            className={`id flex h-6 items-center gap-1 rounded-sm px-1.5 ${chipClass}`}
          >
            {entry}
            <button
              type="button"
              aria-label={`Remove ${entry}`}
              onClick={() => onChange(value.filter((v) => v !== entry))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <input
        className={`${inputClass} mt-1`}
        value={text}
        list={suggestions.length > 0 ? listId : undefined}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => add(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.hint}
            </option>
          ))}
        </datalist>
      )}
    </div>
  );
}
