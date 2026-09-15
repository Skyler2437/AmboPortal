"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ColumnDef, ColumnFiltersState, PaginationState, SortingState,
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreHorizontal, RotateCcw, Search, Upload, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TableColumnMenu } from "./TableColumnMenu";
import { describeColumnFilter } from "@/lib/tableFilters";
import { formatTeamTotal, searchTeam, teamDataColumns, teamMemberName, TEAM_COLUMN_DETAILS, TeamTableRow } from "@/lib/teamTable";
import { cn } from "@/lib/utils";

interface Props {
  rows: TeamTableRow[];
  myRole: string;
  onEdit: (row: TeamTableRow) => void;
  onDelete: (row: TeamTableRow) => void;
  onAdd: () => void;
  onUpload: () => void;
  uploading: boolean;
  uploadFeedback?: React.ReactNode;
}

function RoleBadge({ role }: { role: string }) {
  return <Badge variant="secondary" className={cn("capitalize", (role === "admin" || role === "superadmin") && "border-blue-100 bg-blue-50 text-blue-800")}>{role}</Badge>;
}

function TeamActions({ user, myRole, onEdit, onDelete }: { user: TeamTableRow } & Pick<Props, "myRole" | "onEdit" | "onDelete">) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label={`Actions for ${teamMemberName(user)}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem asChild><Link href={`/admin/users/${user.id}`}>View User</Link></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(user.email)}>Copy Email</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onEdit(user)}>Edit User</DropdownMenuItem>
      <DropdownMenuItem
        disabled={!(myRole === "superadmin" || (myRole === "admin" && user.role !== "admin" && user.role !== "superadmin"))}
        onSelect={() => onDelete(user)} className="text-red-600">Delete User</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function TeamTable({ rows, myRole, onEdit, onDelete, onAdd, onUpload, uploading, uploadFeedback }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [showAll, setShowAll] = useState(true);
  const [pageState, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const pagination = showAll ? { pageIndex: 0, pageSize: Math.max(rows.length, 1) } : pageState;
  const data = useMemo(() => searchTeam(rows, searchQuery), [rows, searchQuery]);
  const roleOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.role))).sort(), [rows]);
  const columns = useMemo<ColumnDef<TeamTableRow>[]>(() => [
    ...teamDataColumns.map((column, index) => ({
      ...column,
      header: TEAM_COLUMN_DETAILS[index].title,
      cell: ({ row }: { row: { original: TeamTableRow } }) => {
        const user = row.original;
        if (index === 0) return <Link href={`/admin/users/${user.id}`} className="font-medium hover:text-primary hover:underline">{teamMemberName(user)}</Link>;
        if (index === 1) return <span className="text-muted-foreground">{user.email}</span>;
        if (index === 2) return <span className="tabular-nums text-muted-foreground">{user.phone}</span>;
        if (index === 3) return <RoleBadge role={user.role} />;
        const value = index === 4 ? user.total_hours : user.total_credits;
        return <span className={cn("font-medium", value == null && "text-muted-foreground")} title={value == null ? "Student totals only" : undefined}>{formatTeamTotal(value)}</span>;
      },
    })),
    { id: "actions", header: "Actions", enableSorting: false, enableColumnFilter: false,
      cell: ({ row }) => <TeamActions user={row.original} myRole={myRole} onEdit={onEdit} onDelete={onDelete} /> },
  ], [myRole, onEdit, onDelete]);

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
    const details = TEAM_COLUMN_DETAILS.find((column) => column.id === id);
    if (!details) return null;
    return <TableColumnMenu column={table.getColumn(id)!} title={details.title} kind={details.kind} options={id === "role" ? roleOptions : undefined} />;
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 sm:max-w-sm"><h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">Student totals include approved submissions from all time.</p></div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
        <div className="relative w-full min-w-0 sm:w-56">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search team" placeholder="Search team..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-9 bg-white pl-9" />
        </div>
        <Button type="button" variant="outline" disabled={uploading} onClick={onUpload} className="flex-1 gap-2 sm:flex-none"><Upload className="h-4 w-4" />{uploading ? "Uploading..." : "CSV Upload"}</Button>
        <Button onClick={onAdd} className="flex-1 gap-2 sm:flex-none"><UserPlus className="h-4 w-4" />Add User</Button>
      </div>
    </div>
    {uploadFeedback}
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-medium" role="status">{filteredCount} of {rows.length} team members</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Use any column to sort or filter. Filter Role to see students only.</p></div>
          {isCustomized && <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={resetView}><RotateCcw className="h-3.5 w-3.5" />Reset view</Button>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 md:hidden" aria-label="Team column controls">
          {TEAM_COLUMN_DETAILS.map((details) => <div key={details.id}>{columnMenu(details.id)}</div>)}
        </div>
        {(columnFilters.length > 0 || sorting.length > 0) && <div className="flex flex-wrap gap-2" aria-label="Active table settings">
          {columnFilters.map((filter) => {
            const details = TEAM_COLUMN_DETAILS.find((column) => column.id === filter.id)!;
            const description = `${details.title}: ${describeColumnFilter(details.kind, filter.value)}`;
            return <button key={filter.id} type="button" aria-label={`Clear ${details.title} filter`} title={description}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-800 hover:bg-blue-100"
              onClick={() => table.getColumn(filter.id)?.setFilterValue(undefined)}>
              <span className="truncate">{description}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>;
          })}
          {sorting.map((sort, index) => {
            const details = TEAM_COLUMN_DETAILS.find((column) => column.id === sort.id)!;
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
        <Table aria-label="Team members and service totals" className="min-w-[900px]">
          <TableHeader className="sticky top-0 z-10 bg-secondary">
            {table.getHeaderGroups().map((group) => <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => <TableHead key={header.id} scope="col"
                aria-sort={header.column.getSortIndex() === 0 ? (header.column.getIsSorted() === "asc" ? "ascending" : "descending") : undefined}
                className={cn("whitespace-nowrap border-r px-3 last:border-r-0", header.id.startsWith("total_") && "text-right")}>
                {header.id === "actions" ? <span className="sr-only">Actions</span> : columnMenu(header.id)}
              </TableHead>)}
            </TableRow>)}
          </TableHeader>
          <TableBody>
            {pageRows.length ? pageRows.map((row) => <TableRow key={row.id} className="even:bg-slate-50/50">
              {row.getVisibleCells().map((cell) => <TableCell key={cell.id}
                className={cn("border-r border-border/50 px-3 py-3 last:border-r-0", cell.column.id.startsWith("total_") && "text-right tabular-nums", cell.column.id === "actions" && "w-12 text-right")}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>)}
            </TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-40 text-center">
              <p className="font-medium">No team members found</p><p className="mt-1 text-muted-foreground">{isCustomized ? "Adjust or clear your filters to see more team members." : "Add your first team member to get started."}</p>
              {isCustomized && <Button variant="outline" size="sm" className="mt-3" onClick={resetView}>Clear filters and sorting</Button>}
            </TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y md:hidden">
        {pageRows.map(({ original: user }) => <div key={user.id} className="flex items-start gap-2 px-4 py-3">
          <Link href={`/admin/users/${user.id}`} className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{teamMemberName(user)}</span><RoleBadge role={user.role} /></div>
            <p className="mt-1 break-all text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">{user.phone}</p>
            {user.role === "student" && <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-secondary/60 px-3 py-2">
              <div><dt className="text-xs text-muted-foreground">Total hours</dt><dd className="text-base font-semibold tabular-nums">{formatTeamTotal(user.total_hours)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Total credits</dt><dd className="text-base font-semibold tabular-nums">{formatTeamTotal(user.total_credits)}</dd></div>
            </dl>}
          </Link>
          <TeamActions user={user} myRole={myRole} onEdit={onEdit} onDelete={onDelete} />
        </div>)}
        {!pageRows.length && <div className="px-4 py-10 text-center"><p className="font-medium">No team members found</p><p className="mt-1 text-sm text-muted-foreground">{isCustomized ? "Adjust or clear your filters." : "Add your first team member to get started."}</p></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
        <p>{filteredCount ? `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min((pagination.pageIndex + 1) * pagination.pageSize, filteredCount)} of ${filteredCount}` : "0 results"}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">Rows per page
            <select aria-label="Rows per page" className="h-8 rounded-md border bg-white px-2 text-foreground" value={showAll ? "all" : pageState.pageSize}
              onChange={(e) => {
                const all = e.target.value === "all";
                setShowAll(all);
                setPagination({ pageIndex: 0, pageSize: all ? pageState.pageSize : Number(e.target.value) });
              }}>
              <option value="all">All</option>
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
