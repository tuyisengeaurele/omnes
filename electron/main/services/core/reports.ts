import type { ReportRange } from '@shared/ipc';

// ALL_TIME's lower bound is the Unix epoch, not a null/undefined case — every
// real Sale row's createdAt is necessarily after this, so a plain `gte: from`
// comparison works uniformly for every range in the query functions below,
// with no special-case branch needed there.
export function resolveRange(range: ReportRange, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;

  if (range === 'ALL_TIME') {
    return { from: new Date(0), to };
  }

  if (range === 'TODAY') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  }

  if (range === 'THIS_WEEK') {
    const daysSinceMonday = (now.getDay() + 6) % 7;
    return {
      from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday),
      to,
    };
  }

  // THIS_MONTH
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
}
