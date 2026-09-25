import { inputClass } from '@/components/ui/dialog';
import { useQuery } from '@/lib/ipc';
import { KINDS, type EditableKind } from '@/lib/kinds';

/**
 * Picks another library item by id. References are always explicit ids (concept 02 §4), so the
 * editor never offers free text here: an item that does not exist cannot be referenced.
 */
export function ItemSelect({
  kind,
  value,
  onChange,
  label,
  exclude = [],
  placeholder,
}: {
  kind: EditableKind;
  value: string;
  onChange: (id: string) => void;
  label: string;
  exclude?: string[];
  placeholder?: string;
}) {
  const items = useQuery('library.list', { kind }, { on: ['library.changed'] });
  const options = (items.data ?? []).filter((row) => !exclude.includes(row.id));

  return (
    <select
      className={inputClass}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder ?? `No ${KINDS[kind].label.toLowerCase()}`}</option>
      {options.map((row) => (
        <option key={row.id} value={row.id}>
          {row.name} — {row.description.slice(0, 60)}
        </option>
      ))}
    </select>
  );
}
