import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, Download } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSearch?: (search: string) => void;
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  isLoading?: boolean;
  onExport?: () => void;
  actions?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  searchPlaceholder?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  total,
  page,
  pageSize,
  onPageChange,
  onSearch,
  onSort,
  isLoading,
  onExport,
  actions,
  emptyMessage = 'No records found',
  searchPlaceholder = 'Search...',
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const debouncedSearch = useDebounce(search, 300);

  const totalPages = Math.ceil(total / pageSize);

  const handleSearch = (val: string) => {
    setSearch(val);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prevSearch = useState(debouncedSearch)[0];
  if (prevSearch !== debouncedSearch && onSearch) {
    onSearch(debouncedSearch);
  }

  const handleSort = (key: string) => {
    if (!onSort) return;
    const newDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc';
    setSortKey(key);
    setSortDir(newDir);
    onSort(key, newDir);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        {onSearch && (
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-muted" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
        {onExport && (
          <Button variant="outline" size="sm" onClick={onExport} className="ml-auto">
            <Download className="h-4 w-4" />
            Export
          </Button>
        )}
      </div>

      {!isLoading && data.length === 0 && (
        <div className="rounded-md border bg-white px-4 py-12 text-center text-brand-muted">
          <Search className="mx-auto h-8 w-8 mb-2 opacity-40" />
          {emptyMessage}
        </div>
      )}

      {(isLoading || data.length > 0) && (
        <div className="rounded-md border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn('px-4 py-3 text-left font-medium text-foreground', col.className, col.sortable && 'cursor-pointer select-none hover:bg-muted/50')}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        {col.header}
                        {col.sortable && <ArrowUpDown className="h-3 w-3 text-brand-muted" />}
                      </div>
                    </th>
                  ))}
                  {actions && <th className="px-4 py-3 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b">
                        {columns.map((col) => (
                          <td key={col.key} className="px-4 py-3">
                            <div className="h-4 bg-muted animate-pulse rounded" />
                          </td>
                        ))}
                        {actions && <td className="px-4 py-3"><div className="h-4 w-16 bg-muted animate-pulse rounded ml-auto" /></td>}
                      </tr>
                    ))
                  : data.map((row) => (
                      <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                        {columns.map((col) => (
                          <td key={col.key} className={cn('px-4 py-3', col.className)}>
                            {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '-')}
                          </td>
                        ))}
                        {actions && <td className="px-4 py-3 text-right">{actions(row)}</td>}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-brand-muted">
        <span>
          {total === 0 ? 'No records' : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => onPageChange(1)} disabled={page === 1}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2">
            Page {page} of {totalPages || 1}
          </span>
          <Button variant="ghost" size="icon" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
