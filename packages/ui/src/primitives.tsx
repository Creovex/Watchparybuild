'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './icons';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// Buttons ------------------------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

const variantClass: Record<Variant, string> = {
  primary:
    'bg-amber text-amber-ink hover:bg-amber-bright active:bg-amber-deep disabled:bg-surface-3 disabled:text-faint',
  secondary:
    'bg-surface-3 text-text ring-1 ring-inset ring-line-strong hover:bg-line active:bg-surface-2 disabled:text-faint disabled:ring-line',
  ghost: 'bg-transparent text-text hover:bg-surface-3 active:bg-surface-2 disabled:text-faint',
  danger: 'bg-red-strong text-white hover:brightness-110 active:brightness-95 disabled:bg-surface-3 disabled:text-faint',
};

const sizeClass: Record<Size, string> = {
  md: 'min-h-11 px-4 text-sm gap-2',
  lg: 'min-h-13 px-6 text-base gap-2.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  busy?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, busy = false, block = false, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'relative inline-flex select-none items-center justify-center rounded-lg font-semibold transition-colors duration-150 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'lg' ? 22 : 20} className={busy ? 'opacity-0' : undefined} /> : null}
      <span className={busy ? 'opacity-0' : undefined}>{children}</span>
      {busy ? <BusyBar /> : null}
    </button>
  );
});

/** A short indeterminate bar inside a busy button; it keeps the button's size so nothing shifts. */
function BusyBar() {
  return (
    <span className="absolute inset-x-6 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-current/20" aria-hidden="true">
      <span className="block h-full w-1/3 animate-[busy_900ms_var(--ease-move)_infinite] rounded-full bg-current motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-60" />
    </span>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  /** Show the label under the icon (bottom bars) instead of only to assistive technology. */
  showLabel?: boolean;
  tone?: 'default' | 'active' | 'danger' | 'muted';
}

const toneClass = {
  default: 'text-text hover:bg-surface-3',
  active: 'bg-amber text-amber-ink hover:bg-amber-bright',
  danger: 'text-red hover:bg-surface-3',
  muted: 'bg-surface-3 text-red hover:bg-line',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, showLabel = false, tone = 'default', className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
      className={cx(
        'inline-flex shrink-0 select-none flex-col items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        showLabel ? 'min-h-14 min-w-16 gap-1 px-2 py-1.5' : 'size-11',
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={22} />
      {showLabel ? <span className="text-xs font-medium leading-none">{label}</span> : null}
    </button>
  );
});

// Form fields --------------------------------------------------------------------------------------

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  id: string;
  children: ReactNode;
  optional?: boolean;
}

function FieldShell({ label, hint, error, id, children, optional }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-text">
        {label}
        {optional ? <span className="ml-2 font-normal text-faint">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-red">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg bg-surface-1 px-3.5 py-3 text-base text-text ring-1 ring-inset ring-line-strong placeholder:text-faint transition-shadow focus:outline-none focus:ring-2 focus:ring-amber aria-invalid:ring-red disabled:opacity-60';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} id={fieldId} optional={optional}>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cx(inputClass, className)}
        {...rest}
      />
    </FieldShell>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

export function TextArea({ label, hint, error, optional, id, className, ...rest }: TextAreaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldShell label={label} hint={hint} error={error} id={fieldId} optional={optional}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cx(inputClass, 'min-h-24 resize-y', className)}
        {...rest}
      />
    </FieldShell>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
}

/** A group of large radio cards: every option and its consequence visible at once. */
export function ChoiceGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 2,
  name,
}: {
  legend: string;
  options: ReadonlyArray<ChoiceOption<T>>;
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 4;
  name: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold text-text">{legend}</legend>
      <div className={cx('grid gap-2', columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2')}>
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cx(
                'relative flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-lg px-3.5 py-3 ring-1 ring-inset transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-amber',
                checked ? 'bg-surface-3 ring-amber' : 'bg-surface-1 ring-line hover:ring-line-strong',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-semibold">
                {option.icon ? <Icon name={option.icon} size={18} className={checked ? 'text-amber' : 'text-muted'} /> : null}
                {option.label}
                {checked ? <Icon name="check" size={16} className="ml-auto text-amber" /> : null}
              </span>
              {option.description ? <span className="text-sm text-muted">{option.description}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** An on/off switch with its label and consequence. */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-start justify-between gap-4 py-2">
      <div className="flex flex-col">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {description ? <span className="text-sm text-muted">{description}</span> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full ring-1 ring-inset transition-colors disabled:opacity-50',
          checked ? 'bg-amber ring-amber' : 'bg-surface-1 ring-line-strong',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'inline-block size-5 rounded-full transition-transform duration-150',
            checked ? 'translate-x-6 bg-amber-ink' : 'translate-x-1 bg-muted',
          )}
        />
      </button>
    </div>
  );
}

// Sheet: a bottom sheet on phones and a centred panel on wider screens, built on <dialog> so focus
// is trapped and Escape closes it natively.

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[88dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface-2 p-0 text-text shadow-none backdrop:bg-black/60 open:flex open:animate-sheet-in open:flex-col sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      {/* Closed sheets render nothing, so their fields and effects never exist twice on the page. */}
      <div className="flex-1 overflow-y-auto px-5 py-4">{open ? children : null}</div>
      {footer && open ? <div className="safe-bottom border-t border-line px-5 pt-3">{footer}</div> : null}
    </dialog>
  );
}

// Toasts -------------------------------------------------------------------------------------------

type ToastTone = 'info' | 'error' | 'success';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current++;
    setItems((current) => [...current.filter((t) => t.message !== message), { id, message, tone }].slice(-3));
    window.setTimeout(() => setItems((current) => current.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{ zIndex: 'var(--z-toast)' }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex max-w-md animate-pop-in items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium ring-1 ring-inset',
              item.tone === 'error' ? 'bg-surface-3 text-text ring-red' : 'bg-surface-3 text-text ring-line-strong',
            )}
          >
            <Icon
              name={item.tone === 'error' ? 'alert' : item.tone === 'success' ? 'check' : 'info'}
              size={18}
              className={cx('mt-0.5 shrink-0', item.tone === 'error' ? 'text-red' : item.tone === 'success' ? 'text-green' : 'text-amber')}
            />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// People -------------------------------------------------------------------------------------------

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0]!)[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1]!)[0] ?? '' : '';
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 40,
  speaking = false,
  dimmed = false,
}: {
  name: string;
  src?: string | null;
  size?: number;
  speaking?: boolean;
  dimmed?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 font-semibold text-muted ring-2 transition-[box-shadow,color] duration-150',
        speaking ? 'ring-green' : 'ring-transparent',
        dimmed && 'opacity-50',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {src && !failed ? (
        // Google profile photos; no referrer so the request carries no room address.
        <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Room capacity drawn as a row of cinema seats; taken seats are lit. */
export function SeatRow({ cap, taken, size = 22, label }: { cap: number; taken: number; size?: number; label?: string }) {
  const seats = useMemo(() => Array.from({ length: cap }, (_, i) => i < taken), [cap, taken]);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label ?? `${taken} of ${cap} seats taken`}>
      {seats.map((lit, i) => (
        <Icon key={i} name="seat" size={size} className={lit ? 'text-amber' : 'text-line-strong'} />
      ))}
    </span>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'amber' | 'green' | 'red' }) {
  const tones = {
    default: 'bg-surface-3 text-muted',
    amber: 'bg-amber/15 text-amber',
    green: 'bg-green/15 text-green',
    red: 'bg-red/15 text-red',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  );
}

/** Inline notice for errors and explanations that belong to one part of a screen. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'error' | 'success';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cx(
        'flex gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset',
        tone === 'error' ? 'bg-red/10 ring-red/50' : tone === 'success' ? 'bg-green/10 ring-green/40' : 'bg-surface-2 ring-line',
      )}
    >
      <Icon
        name={tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'}
        size={18}
        className={cx('mt-0.5 shrink-0', tone === 'error' ? 'text-red' : tone === 'success' ? 'text-green' : 'text-amber')}
      />
      <div className="flex flex-1 flex-col gap-2">
        {title ? <p className="font-semibold text-text">{title}</p> : null}
        <div className="text-muted">{children}</div>
        {action}
      </div>
    </div>
  );
}

/** Copies text and reports success in the button label for two seconds. */
export function useCopy(): [(text: string) => Promise<boolean>, boolean] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      return false;
    }
  }, []);
  return [copy, copied];
}
