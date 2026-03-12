/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type ExpandedState,
  type Row,
  type RowData,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
  }
}

export type TableData = {
  name: string;
  path: string;
  sha?: string;
  content?: string;
  object?: Record<string, unknown>;
  type: "file" | "dir";
  node?: boolean;
  parentPath?: string;
  subRows?: TableData[];
  fields?: Record<string, unknown>;
};

const LShapeIcon = ({ className }: { className?: string }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      d="M4 4V11C4 12.0609 4.42143 13.0783 5.17157 13.8284C5.92172 14.5786 6.93913 15 8 15H20"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function CollectionTable<TData extends TableData>({
  columns,
  data,
  initialState,
  search,
  setSearch,
  onExpand,
  pathname,
  path,
  isTree = false,
  primaryField,
}: {
  columns: Array<ColumnDef<TData>>;
  data: TData[];
  initialState?: Record<string, unknown>;
  search: string;
  setSearch: (value: string) => void;
  onExpand: (row: TData) => Promise<unknown>;
  pathname: string;
  path: string;
  isTree?: boolean;
  primaryField?: string;
}) {
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [loadingRows, setLoadingRows] = useState<Record<string, boolean>>({});

  const handleRowExpansion = useCallback(
    async (row: Row<TData>) => {
      const needsLoading =
        row.getCanExpand() && !row.getIsExpanded() && row.original.subRows === undefined;

      if (needsLoading) {
        setLoadingRows((prev) => ({ ...prev, [row.id]: true }));
        try {
          await onExpand(row.original);
        } catch (error) {
          console.error("onExpand failed for row:", row.id, error);
          setLoadingRows((prev) => {
            const nextState = { ...prev };
            delete nextState[row.id];
            return nextState;
          });
          return;
        } finally {
          setLoadingRows((prev) => {
            const nextState = { ...prev };
            delete nextState[row.id];
            return nextState;
          });
        }
      }

      row.toggleExpanded();
    },
    [onExpand]
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState,
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: (row) => row.original.node || row.original.type === "dir",
    getSubRows: (row): TData[] | undefined => row.subRows as TData[] | undefined,
    state: {
      globalFilter: search,
      expanded,
    },
    onGlobalFilterChange: setSearch,
    onExpandedChange: setExpanded,
  });

  useEffect(() => {
    if (!isTree) {
      return;
    }

    table.getRowModel().rows.forEach((row) => {
      if (
        !row.getIsExpanded() &&
        ((row.original.node &&
          row.original.parentPath &&
          path.startsWith(row.original.parentPath)) ||
          (row.original.type === "dir" && path.startsWith(row.original.path)))
      ) {
        void handleRowExpansion(row as Row<TData>);
      }
    });
  }, [data, handleRowExpansion, isTree, path, table]);

  useEffect(() => {
    table.setOptions((prev) => ({
      ...prev,
      data,
    }));
  }, [data, table]);

  return (
    <div className="space-y-2">
      <Table className="border-separate border-spacing-0 text-base">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="sticky -top-4 z-20 bg-background hover:bg-background md:-top-6"
            >
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    "h-12 cursor-pointer truncate border-b px-3 text-xs select-none first:pl-0 last:cursor-default last:pr-0 last:hover:bg-background hover:bg-muted/50",
                    header.column.columnDef.meta?.className
                  )}
                  onClick={header.column.getToggleSortingHandler()}
                  title={
                    header.column.getCanSort()
                      ? header.column.getNextSortingOrder() === "asc"
                        ? "Sort ascending"
                        : header.column.getNextSortingOrder() === "desc"
                          ? "Sort descending"
                          : "Clear sort"
                      : undefined
                  }
                >
                  <div className="flex items-center gap-x-2">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {{
                      asc: <ArrowUp className="h-4 w-4 opacity-50" />,
                      desc: <ArrowDown className="h-4 w-4 opacity-50" />,
                    }[header.column.getIsSorted() as string] ?? null}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.original.type === "dir" ? (
                  <>
                    <TableCell
                      colSpan={columns.length - 1}
                      className="h-14 border-b px-3 py-0 first:pl-0 last:pr-0"
                      style={{
                        paddingLeft: row.depth > 0 ? `${row.depth * 2}rem` : undefined,
                      }}
                    >
                      {isTree ? (
                        <button
                          className="flex items-center gap-x-2 font-medium"
                          onClick={() => void handleRowExpansion(row as Row<TData>)}
                        >
                          {loadingRows[row.id] ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : row.getIsExpanded() ? (
                            <FolderOpen className="h-4 w-4" />
                          ) : (
                            <Folder className="h-4 w-4" />
                          )}
                          {row.original.name}
                        </button>
                      ) : (
                        <Link
                          className="flex items-center gap-x-2 font-medium"
                          href={`${pathname}?path=${encodeURIComponent(row.original.path)}`}
                        >
                          <Folder className="h-4 w-4" />
                          {row.original.name}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="h-14 border-b px-3 py-0 first:pl-0 last:pr-0">
                      {(() => {
                        const lastCell =
                          row.getVisibleCells()[row.getVisibleCells().length - 1];
                        return flexRender(
                          lastCell.column.columnDef.cell,
                          lastCell.getContext()
                        );
                      })()}
                    </TableCell>
                  </>
                ) : (
                  row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "h-14 border-b px-3 py-0 first:pl-0 last:pr-0",
                        cell.column.columnDef.meta?.className
                      )}
                      style={{
                        paddingLeft:
                          cell.column.id === primaryField && row.depth > 0
                            ? `${row.depth * 1.5}rem`
                            : undefined,
                      }}
                    >
                      <div className="flex items-center gap-x-1">
                        {row.depth > 0 && cell.column.id === primaryField ? (
                          <LShapeIcon className="h-4 w-4 text-muted-foreground opacity-50" />
                        ) : null}
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        {isTree && row.getCanExpand() && cell.column.id === primaryField ? (
                          loadingRows[row.id] ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="h-6 w-6 rounded-full"
                              disabled
                            >
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="h-6 w-6 rounded-full"
                              onClick={() => void handleRowExpansion(row as Row<TData>)}
                              disabled={row.getIsExpanded() && row.subRows.length === 0}
                            >
                              {row.getIsExpanded() ? (
                                <CircleMinus className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                              ) : (
                                <CirclePlus className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                              )}
                              <span className="sr-only">
                                {row.getIsExpanded() ? "Collapse row" : "Expand row"}
                              </span>
                            </Button>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  ))
                )}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-6 text-center text-sm text-muted-foreground">
                <div className="inline-flex items-center justify-center">
                  <Ban className="mr-2 h-4 w-4" />
                  No entries
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {table.getCanPreviousPage() || table.getCanNextPage() ? (
        <footer className="flex items-center gap-x-2">
          <div className="mr-auto text-sm text-muted-foreground">
            {`Page ${table.getState().pagination.pageIndex + 1} of ${table.getPageCount()}`}
          </div>
          <div className="flex">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
