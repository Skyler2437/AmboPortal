"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ColumnDef, ColumnFiltersState, PaginationState, SortingState,
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal, RotateCcw, Search, Upload, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableColumnMenu } from "./TableColumnMenu";
import { describeColumnFilter } from "@/lib/tableFilters";
import { searchSubmissions, studentName, submissionDataColumns, SUBMISSION_COLUMN_DETAILS, SubmissionTableRow } from "@/lib/submissionTable";
import { cn } from "@/lib/utils";

interface Props {
  rows: SubmissionTableRow[];
  onEdit: (row: SubmissionTableRow) => void;
  onQuickAction: (row: SubmissionTableRow, status: "Approved" | "Denied") => void;
  onUpload: () => void;
  uploading: boolean;
  uploadFeedback?: React.ReactNode;
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant="secondary" className={cn("whitespace-nowrap",
    status === "Approved" ? "border-green-200 bg-green-100 text-green-800 hover:bg-green-100/80"
      : status === "Denied" ? "border-red-100 bg-red-50 text-red-700 hover:bg-red-50"
        : "border-yellow-200 bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80"
  )}>{status}</Badge>;
}

export function SubmissionsTable({ rows, onEdit, onQuickAction, onUpload, uploading, uploadFeedback }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const data = useMemo(() => searchSubmissions(rows, searchQuery), [rows, searchQuery]);
  const valueOptions = useMemo(() => ({
    service_type: Array.from(new Set(rows.map((row) => row.service_type))).sort((a, b) => a.localeCompare(b)),
    status: Array.from(new Set(["Pending", "Approved", "Denied", ...rows.map((row) => row.status)])),
  }), [rows]);
  const statusCounts = useMemo(() => ({
    All: rows.length,
    Pending: rows.filter((row) => row.status === "Pending").length,
    Approved: rows.filter((row) => row.status === "Approved").length,
    Denied: rows.filter((row) => row.status === "Denied").length,
  }), [rows]);

  const columns = useMemo<ColumnDef<SubmissionTableRow>[]>(() => [
    ...submissionDataColumns.map((column, index) => ({
      ...column,
      header: SUBMISSION_COLUMN_DETAILS[index].title,
      ...(index === 0 ? { cell: ({ row }: { row: { original: SubmissionTableRow } }) => <div className="min-w-0">
        <div className="font-medium">{studentName(row.original)}</div>
        {row.original.users && <div className="text-xs text-muted-foreground">{row.original.users.email}</div>}
      </div> } : {}),
      ...(index === 5 ? { cell: ({ row }: { row: { original: SubmissionTableRow } }) => <StatusBadge status={row.original.status} /> } : {}),
    })),
    {
      id: "actions", header: "Actions", enableSorting: false, enableColumnFilter: false,
      cell: ({ row }) => <div className="flex items-center justify-end gap-1">
        {row.original.status === "Pending" && <>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:bg-green-50 hover:text-green-700"
            onClick={() => onQuickAction(row.original, "Approved")} aria-label="Approve submission" title="Approve">
            <CheckCircle2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => onQuickAction(row.original, "Denied")} aria-label="Deny submission" title="Deny">
            <XCircle className="h-4 w-4" />
          </Button>
        </>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0" aria-label={`Actions for ${studentName(row.original)} on ${row.original.service_date}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onEdit(row.original)}>Edit Submission</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
    },
  ], [onEdit, onQuickAction]);

  const table = useReactTable({
    data, columns, getRowId: (row) => row.id,
    state: { columnFilters, sorting, pagination },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: true,
  });

  const statusColumn = table.getColumn("status")!;
  const selectedStatuses = statusColumn.getFilterValue() as string[] | undefined;
  const statusShortcut = selectedStatuses === undefined ? "All" : selectedStatuses.length === 1 ? selectedStatuses[0] : null;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageRows = table.getRowModel().rows;
  const isCustomized = columnFilters.length > 0 || sorting.length > 0 || !!searchQuery;
  const resetView = () => {
    table.resetColumnFilters(true);
    table.resetSorting(true);
    setSearchQuery("");
    table.setPageIndex(0);
  };
  const columnMenu = (id: string) => {
    const details = SUBMISSION_COLUMN_DETAILS.find((column) => column.id === id);
    if (!details) return null;
    return <TableColumnMenu column={table.getColumn(id)!} title={details.title} kind={details.kind}
      textLabel="Name or email contains" textPlaceholder="Search students..."
      options={id === "service_type" ? valueOptions.service_type : id === "status" ? valueOptions.status : undefined} />;
  };

  return <div className="space-y-4">
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="status-filters" aria-label="Submission status shortcuts">
          {(["All", "Pending", "Approved", "Denied"] as const).map((status) => <Button key={status}
            variant={statusShortcut === status ? "default" : "outline"} size="sm" aria-pressed={statusShortcut === status}
            onClick={() => statusColumn.setFilterValue(status === "All" ? undefined : [status])} className="gap-1.5">
            {status}<Badge variant="secondary" className="ml-0.5 min-w-5 px-1.5 py-0 text-center text-[10px]">{statusCounts[status]}</Badge>
          </Button>)}
        </div>
        <div className="flex items-center gap-2 lg:ml-auto">
          <Button type="button" variant="secondary" disabled={uploading} onClick={onUpload} className="shrink-0 gap-2">
            <Upload className="h-4 w-4" />{uploading ? "Uploading..." : "CSV Upload"}
          </Button>
          <div className="relative min-w-0 flex-1 lg:w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="Search submissions" placeholder="Search student or type..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-9 pl-9" />
          </div>
        </div>
      </div>
      {uploadFeedback}
    </div>

    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-medium" role="status">{filteredCount} of {rows.length} submissions</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Use any column to sort or filter.</p></div>
          {isCustomized && <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={resetView}><RotateCcw className="h-3.5 w-3.5" />Reset view</Button>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 md:hidden" aria-label="Submission column controls">
          {SUBMISSION_COLUMN_DETAILS.map((details) => <div key={details.id}>{columnMenu(details.id)}</div>)}
        </div>
        {(columnFilters.length > 0 || sorting.length > 0) && <div className="flex flex-wrap gap-2" aria-label="Active table settings">
          {columnFilters.map((filter) => {
            const details = SUBMISSION_COLUMN_DETAILS.find((column) => column.id === filter.id)!;
            const description = `${details.title}: ${describeColumnFilter(details.kind, filter.value)}`;
            return <button key={filter.id} type="button" aria-label={`Clear ${details.title} filter`} title={description}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
              onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}>
              <span className="truncate">{description}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>;
          })}
          {sorting.map((sort, index) => {
            const details = SUBMISSION_COLUMN_DETAILS.find((column) => column.id === sort.id)!;
            return <button key={sort.id} type="button" aria-label={`Clear ${details.title} sort`}
              className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => table.getColumn(sort.id)?.clearSorting()}>
              {sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
              {index + 1}. {details.title}<X className="h-3 w-3" aria-hidden="true" />
            </button>;
          })}
        </div>}
      </div>

      <div className="hidden md:block [&>div]:max-h-[65vh]">
        <Table aria-label="Service submissions" className="min-w-[860px]">
          <TableHeader className="sticky top-0 z-10 bg-secondary">
            {table.getHeaderGroups().map((group) => <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => <TableHead key={header.id} scope="col"
                aria-sort={header.column.getSortIndex() === 0 ? (header.column.getIsSorted() === "asc" ? "ascending" : "descending") : undefined}
                className={cn("whitespace-nowrap border-r px-3 last:border-r-0", (header.id === "hours" || header.id === "credits" || header.id === "actions") && "text-right")}>
                {header.id === "actions" ? <span className="sr-only">Actions</span> : columnMenu(header.id)}
              </TableHead>)}
            </TableRow>)}
          </TableHeader>
          <TableBody>
            {pageRows.length ? pageRows.map((row) => <TableRow key={row.id} className="even:bg-slate-50/50">
              {row.getVisibleCells().map((cell) => <TableCell key={cell.id}
                className={cn("border-r border-border/50 px-3 py-3 last:border-r-0", (cell.column.id === "hours" || cell.column.id === "credits") && "text-right tabular-nums", cell.column.id === "service_date" && "whitespace-nowrap tabular-nums", cell.column.id === "actions" && "w-28")}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>)}
            </TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-40 text-center">
              <p className="font-medium">No submissions found</p><p className="mt-1 text-muted-foreground">{isCustomized ? "Adjust or clear your filters to see more submissions." : "Submissions will appear here once students log hours."}</p>
              {isCustomized && <Button variant="outline" size="sm" className="mt-3" onClick={resetView}>Clear filters and sorting</Button>}
            </TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y md:hidden">
        {pageRows.map(({ original: row }) => <Link key={row.id} href={`/admin/submissions/${row.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{studentName(row)}</span><StatusBadge status={row.status} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{row.service_type} · {row.hours}h · {row.credits} credits · {row.service_date}</p></div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>)}
        {!pageRows.length && <div className="px-4 py-10 text-center"><p className="font-medium">No submissions found</p><p className="mt-1 text-sm text-muted-foreground">{isCustomized ? "Adjust or clear your filters." : "Submissions will appear here once students log hours."}</p></div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <p>{filteredCount ? `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min((pagination.pageIndex + 1) * pagination.pageSize, filteredCount)} of ${filteredCount}` : "0 results"}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">Rows per page
            <select aria-label="Rows per page" className="h-8 rounded-md border bg-white px-2 text-foreground" value={pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <span className="tabular-nums">Page {pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Go to first page" disabled={!table.getCanPreviousPage()} onClick={() => table.setPageIndex(0)}><ChevronsLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Go to previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Go to next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Go to last page" disabled={!table.getCanNextPage()} onClick={() => table.setPageIndex(table.getPageCount() - 1)}><ChevronsRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>
    </div>
  </div>;
}
