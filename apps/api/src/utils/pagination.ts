import { Request } from 'express';

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
}

export function getPagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query['page'] as string ?? '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query['pageSize'] as string ?? '20', 10)));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
) {
  return {
    success: true,
    data,
    total,
    page,
    pageSize,
  };
}
