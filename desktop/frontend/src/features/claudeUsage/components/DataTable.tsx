import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { pageCount, pageSlice, sortRows, type SortDirection } from '../logic';
import styles from './charts.module.scss';

export interface Column<T> {
  id: string;
  label: string;
  numeric?: boolean;
  /** Takes the spare width and truncates, so the other columns never scroll away. */
  grow?: boolean;
  /** Present when the column can be sorted. */
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  defaultSort?: { id: string; direction: SortDirection };
  pageSize?: number;
}

/** Sortable, optionally paginated table built on the shared Table primitives. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  defaultSort,
  pageSize,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sort, setSort] = useState(defaultSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((item) => item.id === sort.id) : undefined;
    return column?.sortValue && sort ? sortRows(rows, column.sortValue, sort.direction) : rows;
  }, [columns, rows, sort]);

  const pages = pageSize ? pageCount(sorted.length, pageSize) : 1;
  const current = Math.min(page, pages - 1);
  const visible = pageSize ? pageSlice(sorted, current, pageSize) : sorted;

  const toggleSort = (column: Column<T>) => {
    setPage(0);
    setSort((previous) =>
      previous?.id === column.id
        ? { id: column.id, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { id: column.id, direction: column.numeric ? 'desc' : 'asc' }
    );
  };

  return (
    <div className={styles.tableBlock}>
      <Table className={styles.usageTable}>
        <caption className={styles.srOnly}>{caption}</caption>
        <TableHeader>
          <tr>
            {columns.map((column) => {
              const sortedBy = sort?.id === column.id ? sort.direction : null;
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  alignRight={column.numeric}
                  aria-sort={
                    sortedBy === 'asc'
                      ? 'ascending'
                      : sortedBy === 'desc'
                        ? 'descending'
                        : undefined
                  }
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      data-active={sortedBy !== null || undefined}
                      onClick={() => toggleSort(column)}
                    >
                      {column.label}
                      <span className={styles.sortMark} aria-hidden="true">
                        {sortedBy === 'asc' ? '↑' : sortedBy === 'desc' ? '↓' : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </TableHead>
              );
            })}
          </tr>
        </TableHeader>
        <TableBody>
          {visible.map((row, index) => (
            <TableRow key={rowKey(row, index)}>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  alignRight={column.numeric}
                  className={
                    [column.numeric ? styles.numCell : '', column.grow ? styles.growCell : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pageSize && pages > 1 ? (
        <nav className={styles.pager} aria-label={t('claude_usage.table.pages', { caption })}>
          <span className={styles.pagerText}>
            {t('claude_usage.table.rows', {
              from: current * pageSize + 1,
              to: Math.min(sorted.length, (current + 1) * pageSize),
              total: sorted.length,
            })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
          >
            {t('claude_usage.table.prev')}
          </Button>
          <span className={styles.pagerText} aria-live="polite">
            {t('claude_usage.table.page', { page: current + 1, pages })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
          >
            {t('claude_usage.table.next')}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
