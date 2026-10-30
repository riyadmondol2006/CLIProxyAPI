import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Select, type SelectOption } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { configFieldDomId } from '../../searchIndex';
import { resolveRowSpans } from './rowSpans';
import styles from './Field.module.scss';

/** Pulse highlight class for search jumps (imperatively added/removed by useFieldJump). */
export const FIELD_HIGHLIGHT_CLASS: string = styles.fieldHighlightActive;

/**
 * Form control host class: scope root for the :global(.input/.form-group/...) overrides inside
 * block editors. SectionCard's content area applies it automatically; apply it manually when
 * rendering form blocks outside a card (e.g. Modal content).
 */
export const FIELDS_ROOT_CLASS: string = styles.fieldsRoot;

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

/* ======================================================================
   Setting row: toggle / input / select / block editor share the same skeleton:
   left column "title + description + error", right column the control; only the control
   slot's content differs. Rows sit in a SettingList (rounded container + hairline dividers)
   and lay out in two columns in wide containers.
   ====================================================================== */

type SettingCopy = {
  /** Search anchor: the row itself is the anchor (see configFieldDomId for the DOM id). */
  fieldId: string;
  label: string;
  description?: ReactNode;
  error?: string;
  /**
   * Takes a full row in the two-column layout; set it only for semantic reasons (long URLs, a
   * master toggle at the top). Orphaned rows (at the end, or before a full-width item) are
   * widened automatically by SettingList, so there's no need to balance odd/even counts by hand.
   */
  wide?: boolean;
};

type SettingIds = { controlId: string; labelId: string; hintId: string; errorId: string };

function useSettingIds(fieldId: string): SettingIds {
  const controlId = useId();
  return {
    controlId,
    labelId: `${controlId}-${fieldId}-label`,
    hintId: `${controlId}-hint`,
    errorId: `${controlId}-error`,
  };
}

function describedBy(ids: SettingIds, description: ReactNode, error?: string) {
  return (
    [error ? ids.errorId : '', description ? ids.hintId : ''].filter(Boolean).join(' ') || undefined
  );
}

type RowKind = 'toggle' | 'input' | 'block';
type ControlSize = 'sm' | 'md' | 'lg';

function SettingRow({
  fieldId,
  label,
  description,
  error,
  wide,
  ids,
  kind,
  size,
  labelFor,
  control,
}: SettingCopy & {
  ids: SettingIds;
  kind: RowKind;
  size?: ControlSize;
  /**
   * With a single control the title is a <label htmlFor>; block editors have no single control,
   * so the title only names the group.
   */
  labelFor?: string;
  control: ReactNode;
}) {
  return (
    <div
      id={configFieldDomId(fieldId)}
      className={cx(
        styles.row,
        kind === 'toggle' && styles.rowToggle,
        kind === 'block' && styles.rowBlock,
        size && styles[`size_${size}`],
        (wide || kind === 'block') && styles.rowWide
      )}
    >
      <div className={styles.rowCopy}>
        {labelFor ? (
          <label id={ids.labelId} htmlFor={labelFor} className={styles.rowLabel}>
            {label}
          </label>
        ) : (
          <span id={ids.labelId} className={styles.rowLabel}>
            {label}
          </span>
        )}
        {description ? (
          <div id={ids.hintId} className={styles.rowDescription}>
            {description}
          </div>
        ) : null}
        {error ? (
          <div id={ids.errorId} className={styles.rowError}>
            {error}
          </div>
        ) : null}
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  );
}

export function ToggleSetting({
  checked,
  disabled,
  onChange,
  ...copy
}: Omit<SettingCopy, 'error'> & {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const ids = useSettingIds(copy.fieldId);
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="toggle"
      labelFor={ids.controlId}
      control={
        <ToggleSwitch
          id={ids.controlId}
          checked={checked}
          disabled={disabled}
          onChange={onChange}
          ariaDescribedBy={describedBy(ids, copy.description)}
        />
      }
    />
  );
}

type NativeInputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'placeholder' | 'min' | 'max' | 'autoComplete'
>;

export function TextSetting({
  value,
  disabled,
  onChange,
  size = 'md',
  adornment,
  type = 'text',
  placeholder,
  min,
  max,
  autoComplete,
  ...copy
}: SettingCopy &
  NativeInputProps & {
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
    /** sm = numbers / durations; md = plain text; lg = long text such as URLs, paths, UAs. */
    size?: ControlSize;
    /** Status marker on the right inside the input (e.g. "disabled" when keepalive is 0). */
    adornment?: ReactNode;
  }) {
  const ids = useSettingIds(copy.fieldId);
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="input"
      size={size}
      labelFor={ids.controlId}
      control={
        <>
          <input
            id={ids.controlId}
            className={cx('input', adornment ? styles.inputWithAdornment : undefined)}
            type={type}
            value={value}
            placeholder={placeholder}
            min={min}
            max={max}
            autoComplete={autoComplete}
            spellCheck={false}
            disabled={disabled}
            aria-invalid={Boolean(copy.error)}
            aria-describedby={describedBy(ids, copy.description, copy.error)}
            onChange={(event) => onChange(event.target.value)}
          />
          {adornment ? <span className={styles.adornment}>{adornment}</span> : null}
        </>
      }
    />
  );
}

export function SelectSetting<T extends string>({
  value,
  options,
  disabled,
  onChange,
  size = 'md',
  ...copy
}: SettingCopy & {
  value: T;
  options: ReadonlyArray<SelectOption & { value: T }>;
  disabled?: boolean;
  onChange: (value: T) => void;
  size?: ControlSize;
}) {
  const ids = useSettingIds(copy.fieldId);
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="input"
      size={size}
      labelFor={ids.controlId}
      control={
        <Select
          id={ids.controlId}
          className={styles.selectControl}
          fullWidth
          value={value}
          options={options}
          disabled={disabled}
          ariaLabelledBy={ids.labelId}
          ariaDescribedBy={describedBy(ids, copy.description, copy.error)}
          ariaInvalid={copy.error ? true : undefined}
          onChange={(next) => onChange(next as T)}
        />
      }
    />
  );
}

export type BlockSettingA11y = { describedBy?: string; invalid: boolean };

/**
 * Block editor row (string lists, ICE servers, etc.): title and description on top, the editor
 * below taking the full row. The editor is wrapped in role="group", named by the title and
 * described by the description/error; when children is a function, it receives describedBy to
 * attach to inner controls itself.
 */
export function BlockSetting({
  children,
  ...copy
}: Omit<SettingCopy, 'wide'> & {
  children: ReactNode | ((a11y: BlockSettingA11y) => ReactNode);
}) {
  const ids = useSettingIds(copy.fieldId);
  const a11y = {
    describedBy: describedBy(ids, copy.description, copy.error),
    invalid: Boolean(copy.error),
  };
  return (
    <SettingRow
      {...copy}
      ids={ids}
      kind="block"
      control={
        <div
          role="group"
          aria-labelledby={ids.labelId}
          aria-describedby={a11y.describedBy}
          aria-invalid={a11y.invalid || undefined}
        >
          {typeof children === 'function' ? children(a11y) : children}
        </div>
      }
    />
  );
}

/**
 * Block with its own title area (e.g. the API key card editor): provides only the anchor and a
 * full-row cell, without rendering a title.
 */
export function SettingCell({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  return (
    <div id={configFieldDomId(fieldId)} className={cx(styles.row, styles.rowCell, styles.rowWide)}>
      {children}
    </div>
  );
}

type RowElement = ReactElement<{ wide?: boolean; children?: ReactNode }>;

/**
 * Flattens Fragments (e.g. the cert/key rows that appear only when TLS is on) and prefixes
 * nested items to avoid key collisions.
 */
function flattenRows(children: ReactNode, prefix = ''): RowElement[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ wide?: boolean; children?: ReactNode }>(child)) return [];
    if (child.type === Fragment) {
      return flattenRows(child.props.children, `${prefix}${String(child.key)}/`);
    }
    return [prefix ? cloneElement(child, { key: `${prefix}${String(child.key)}` }) : child];
  });
}

const isFullRow = (row: RowElement) =>
  row.type === BlockSetting || row.type === SettingCell || Boolean(row.props.wide);

/**
 * Setting group: an optional group title + a rounded list container. Rows lay out in two
 * columns when the container is wide enough; when narrow they use one column and input rows
 * stack vertically (container queries, adapting to a collapsed sidebar or nested-group indent).
 * Two-column pairing reads only the direct children's props.wide (and the BlockSetting /
 * SettingCell types); a wrapper component that should take a full row must pass wide
 * explicitly at the call site.
 */
export function SettingList({
  title,
  description,
  children,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const rows = flattenRows(children);
  const spans = resolveRowSpans(rows.map(isFullRow));
  // Only with a group title is it a named section; without one it's just a list container.
  const Group = title ? 'section' : 'div';
  return (
    <Group className={styles.group}>
      {title ? (
        <header className={styles.groupHeader}>
          <h3 className={styles.groupTitle}>{title}</h3>
          {description ? <p className={styles.groupDescription}>{description}</p> : null}
        </header>
      ) : null}
      <div className={styles.list}>
        {rows.map((row, index) =>
          spans[index] && !isFullRow(row) ? cloneElement(row, { wide: true }) : row
        )}
      </div>
    </Group>
  );
}

/* ---------- Layout and block editor internal primitives ---------- */

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className={styles.fieldGrid}>{children}</div>;
}

export function FieldStack({ children }: { children: ReactNode }) {
  return <div className={styles.fieldStack}>{children}</div>;
}

// Stable, stateless anchor around a searchable block that is not a setting row
// (payload rule groups). Search jumps target its DOM id and pulse-highlight it.
export function FieldAnchor({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  return (
    <div id={configFieldDomId(fieldId)} className={styles.fieldAnchor}>
      {children}
    </div>
  );
}

/** Standalone hint row (e.g. the description above the editor in a SettingCell). */
export function FieldHint({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className={styles.fieldHint}>
      {children}
    </div>
  );
}

/** "Label on top" field inside block editors (multi-control forms such as payload rules). */
export function FieldShell({
  label,
  labelId,
  htmlFor,
  hint,
  hintId,
  error,
  errorId,
  children,
}: {
  label: string;
  labelId?: string;
  htmlFor?: string;
  hint?: string;
  hintId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.fieldShell}>
      <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
        {label}
      </label>
      {children}
      {error ? (
        <div id={errorId} className="error-box">
          {error}
        </div>
      ) : null}
      {hint ? (
        <div id={hintId} className={styles.fieldHint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
