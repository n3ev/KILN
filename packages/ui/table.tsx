"use client";

import { useMemo, useState, type ReactNode, type UIEvent } from "react";

export interface TableProps {
  columns: ReactNode[];
  rows: ReactNode[][];
  caption?: string;
  height?: number;
  rowHeight?: number;
  virtualizeAt?: number;
}

/**
 * Dense semantic table with fixed-row windowing for large operator datasets.
 * The whole table remains the accessibility boundary while only the visible
 * rows and a small overscan band are mounted.
 */
export function Table({ columns, rows, caption, height = 360, rowHeight = 37, virtualizeAt = 100 }: TableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = rows.length >= virtualizeAt;
  const window = useMemo(() => {
    if (!virtualized) return { start: 0, end: rows.length };
    const overscan = 6;
    const start = Math.max(0, Math.floor(Math.max(0, scrollTop - rowHeight) / rowHeight) - overscan);
    const end = Math.min(rows.length, start + Math.ceil(height / rowHeight) + overscan * 2);
    return { start, end };
  }, [height, rowHeight, rows.length, scrollTop, virtualized]);
  const visibleRows = rows.slice(window.start, window.end);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (virtualized) setScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <div className="k-table-viewport" role="region" aria-label={caption ?? "Data table"} tabIndex={0} style={{ maxHeight: height }} onScroll={onScroll}>
      <table className="k-table" aria-rowcount={rows.length + 1}>
        {caption ? <caption>{caption}</caption> : null}
        <thead><tr>{columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {virtualized && window.start > 0 ? <tr className="k-table-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: window.start * rowHeight }} /></tr> : null}
          {visibleRows.map((row, rowIndex) => <tr key={window.start + rowIndex} aria-rowindex={window.start + rowIndex + 2}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
          {virtualized && window.end < rows.length ? <tr className="k-table-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: (rows.length - window.end) * rowHeight }} /></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
