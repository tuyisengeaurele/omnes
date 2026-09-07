import { describe, expect, it } from 'vitest';
import { nearestAvailableStrategy } from './strategy.js';

describe('nearestAvailableStrategy', () => {
  it('orders candidates by ascending distance', () => {
    const ranked = nearestAvailableStrategy.rank([
      { driverId: 'far', distanceMeters: 5000 },
      { driverId: 'near', distanceMeters: 200 },
      { driverId: 'mid', distanceMeters: 1200 },
    ]);
    expect(ranked.map((c) => c.driverId)).toEqual(['near', 'mid', 'far']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { driverId: 'b', distanceMeters: 2 },
      { driverId: 'a', distanceMeters: 1 },
    ];
    const originalOrder = input.map((c) => c.driverId);
    nearestAvailableStrategy.rank(input);
    expect(input.map((c) => c.driverId)).toEqual(originalOrder);
  });

  it('returns an empty list when given no candidates', () => {
    expect(nearestAvailableStrategy.rank([])).toEqual([]);
  });
});
