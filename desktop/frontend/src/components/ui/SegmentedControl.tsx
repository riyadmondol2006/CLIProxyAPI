import styles from './SegmentedControl.module.scss';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

interface SegmentedControlProps<V extends string> {
  /** Accessible name of the group. */
  label: string;
  value: V;
  options: Array<SegmentedOption<V>>;
  onChange: (value: V) => void;
  size?: 'md' | 'sm';
  className?: string;
}

/** A pill-shaped row of toggle buttons where exactly one option is pressed. */
export function SegmentedControl<V extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      className={[styles.segmented, className].filter(Boolean).join(' ')}
      data-size={size}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
