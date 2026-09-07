/**
 * DispatchStrategy: given a set of eligible driver candidates for an order,
 * decides the order to offer them in. Pure and synchronous - candidate
 * lookup (who is online, near enough, not already busy) is
 * availability.repository.ts's job; this only ranks whatever list it is
 * handed, which is what makes it fast to unit test and easy to swap for a
 * smarter strategy later (load-balanced, batching per FR-DISP-003) without
 * touching anything that fetches candidates.
 */

export interface DispatchCandidate {
  driverId: string;
  distanceMeters: number;
}

export interface DispatchStrategy {
  name: string;
  /** Returns candidates in offer order - index 0 is who gets offered first. */
  rank(candidates: DispatchCandidate[]): DispatchCandidate[];
}

export const nearestAvailableStrategy: DispatchStrategy = {
  name: 'nearest-available',
  rank(candidates: DispatchCandidate[]): DispatchCandidate[] {
    return [...candidates].sort((a, b) => a.distanceMeters - b.distanceMeters);
  },
};
