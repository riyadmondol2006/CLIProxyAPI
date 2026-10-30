/**
 * Which rows in the two-column grid should span the full row: rows explicitly marked wide, and
 * rows that would be left alone (at the start of a row, and either the last item or followed by
 * a full-row item), since otherwise an empty cell is left on the right. Pure function, easy to
 * test. SettingList uses it to decide which child rows get wide injected.
 */
export function resolveRowSpans(wide: readonly boolean[]): boolean[] {
  let column = 0;
  return wide.map((isWide, index) => {
    if (isWide) {
      column = 0;
      return true;
    }
    const orphan = column === 0 && (index === wide.length - 1 || wide[index + 1]);
    column = orphan ? 0 : 1 - column;
    return orphan;
  });
}
