import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'input,select,textarea,button,[href],[tabindex]:not([tabindex="-1"])';

/**
 * A small modal: Escape closes, focus moves in and is trapped, and it returns focus on close.
 * Hand-rolled rather than pulled in, since the app needs one dialog shape and nothing more.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-lg',
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => (restoreTo.current as HTMLElement | null)?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (items.length === 0) return;
      const [first, last] = [items[0]!, items.at(-1)!];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${width} rounded-md border bg-background shadow-lg`}
      >
        <div className="border-b px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-muted-foreground">{description}</p>}
        </div>
        <div className="p-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-7 w-full rounded-sm border bg-background px-2 placeholder:text-muted-foreground focus-visible:border-ring';
