import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from './DataTable';

// Mock the useDebounce hook to return value immediately (no delay in tests)
vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

const columns = [
  { key: 'name' as const, header: 'Name' },
  { key: 'email' as const, header: 'Email' },
];

type Row = { id: string; name: string; email: string };

const mockData: Row[] = [
  { id: '1', name: 'Alice', email: 'alice@test.com' },
  { id: '2', name: 'Bob', email: 'bob@test.com' },
];

const defaultProps = {
  columns,
  data: mockData,
  total: 2,
  page: 1,
  pageSize: 20,
  onPageChange: vi.fn(),
  isLoading: false,
};

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable {...defaultProps} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('renders row data', () => {
    render(<DataTable {...defaultProps} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('bob@test.com')).toBeInTheDocument();
  });

  it('shows default empty state message when no data', () => {
    render(
      <DataTable
        {...defaultProps}
        data={[]}
        total={0}
      />
    );
    expect(screen.getByText('No records found')).toBeInTheDocument();
  });

  it('shows custom empty message when provided', () => {
    render(
      <DataTable
        {...defaultProps}
        data={[]}
        total={0}
        emptyMessage="No sales yet"
      />
    );
    expect(screen.getByText('No sales yet')).toBeInTheDocument();
  });

  it('does not show empty state when loading', () => {
    render(
      <DataTable
        {...defaultProps}
        data={[]}
        total={0}
        isLoading={true}
      />
    );
    // Loading skeleton rows are rendered, not the empty message
    expect(screen.queryByText('No records found')).not.toBeInTheDocument();
  });

  it('shows pagination info with data', () => {
    render(<DataTable {...defaultProps} />);
    // Showing 1-2 of 2
    expect(screen.getByText(/Showing 1-2 of 2/)).toBeInTheDocument();
  });

  it('shows No records text in pagination when data is empty', () => {
    render(<DataTable {...defaultProps} data={[]} total={0} />);
    expect(screen.getByText('No records')).toBeInTheDocument();
  });

  it('renders actions column header when actions prop is provided', () => {
    render(
      <DataTable
        {...defaultProps}
        actions={() => <button>Edit</button>}
      />
    );
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('renders search input when onSearch is provided', () => {
    render(
      <DataTable
        {...defaultProps}
        onSearch={vi.fn()}
        searchPlaceholder="Search sales..."
      />
    );
    expect(screen.getByPlaceholderText('Search sales...')).toBeInTheDocument();
  });

  it('renders export button when onExport is provided', () => {
    render(
      <DataTable
        {...defaultProps}
        onExport={vi.fn()}
      />
    );
    expect(screen.getByText('Export')).toBeInTheDocument();
  });
});
