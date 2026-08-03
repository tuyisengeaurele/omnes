// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveRange } from '../../electron/main/services/core/reports';

// 2024-01-17 is a Wednesday; its Monday (2024-01-15) and the 1st of that
// month (2024-01-01) are both distinct from it and from each other, so
// TODAY/THIS_WEEK/THIS_MONTH each produce a genuinely different boundary
// worth asserting separately.
describe('resolveRange', () => {
  const now = new Date(2024, 0, 17, 14, 30, 0);

  it('TODAY starts at local midnight of the given day', () => {
    const { from, to } = resolveRange('TODAY', now);
    expect(from).toEqual(new Date(2024, 0, 17, 0, 0, 0));
    expect(to).toEqual(now);
  });

  it('THIS_WEEK starts on the most recent Monday', () => {
    const { from } = resolveRange('THIS_WEEK', now);
    expect(from).toEqual(new Date(2024, 0, 15, 0, 0, 0));
  });

  it('THIS_WEEK on a Monday starts on itself', () => {
    const monday = new Date(2024, 0, 15, 9, 0, 0);
    const { from } = resolveRange('THIS_WEEK', monday);
    expect(from).toEqual(new Date(2024, 0, 15, 0, 0, 0));
  });

  it('THIS_MONTH starts on the 1st', () => {
    const { from } = resolveRange('THIS_MONTH', now);
    expect(from).toEqual(new Date(2024, 0, 1, 0, 0, 0));
  });

  it('ALL_TIME has no meaningful lower bound', () => {
    const { from } = resolveRange('ALL_TIME', now);
    expect(from.getTime()).toBeLessThan(new Date(2000, 0, 1).getTime());
  });
});
