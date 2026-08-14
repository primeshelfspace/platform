import { ChevronDown } from 'lucide-react';
import {
  FIELD_INVALID_BORDER as invalidBorder,
  FIELD_VALID_BORDER_PRIMARY as validBorder,
} from './form-styles';

const selectClass =
  'w-full h-10 appearance-none rounded-lg border bg-white px-4 pr-10 text-base text-slate-900 ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.05)] focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-offset-1 transition-colors';

export function Select({
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
  error,
  errorId,
  placeholder,
  children,
}: {
  id?: string;
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  error?: string;
  errorId?: string;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        name={name}
        value={value}
        // A placeholder <option> is rendered `disabled` so it cannot be chosen
        // again — but that also makes the browser skip it when auto-selecting,
        // so it silently lands on the first REAL option instead. The user then
        // submits a value they never picked. Defaulting to '' selects the
        // placeholder, and `required` makes them choose for themselves.
        defaultValue={defaultValue ?? (placeholder && value === undefined ? '' : undefined)}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`${selectClass} ${error ? invalidBorder : validBorder}`}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]"
        aria-hidden
      />
    </div>
  );
}
