/**
 * Dispatch module: driver availability and location, offers, assignment,
 * decision log.
 *
 * This file is the module's only public surface. Other modules import from
 * here, never from a sibling file in this directory. Enforced by the
 * boundaries/element-types rule in the root eslint config.
 */

export {
  nearestAvailableStrategy,
  type DispatchStrategy,
  type DispatchCandidate,
} from './strategy.js';
export {
  createDispatchService,
  type DispatchService,
  type DispatchDeps,
  type DispatchOrderInfo,
  type AdvanceOutcome,
  type RespondOutcome,
  type AssignmentActionOutcome,
} from './dispatch.service.js';
export { createDispatchRouter } from './dispatch.routes.js';
export {
  setDriverOnline,
  setDriverOffline,
  recordDriverLocation,
  findCandidateLocationsInBox,
  type CandidateLocationRow,
} from './availability.repository.js';
export {
  createOffer,
  findOfferById,
  findOpenOfferForOrder,
  findOpenOffersForDriver,
  findTriedDriverIds,
  resolveOffer,
  type OfferRecord,
} from './offer.repository.js';
export {
  createAssignment,
  findAssignmentById,
  findActiveAssignmentForDriver,
  completeAssignment,
  type AssignmentRecord,
} from './assignment.repository.js';
export {
  logDispatchDecision,
  findOrdersAwaitingDispatch,
  type LogDecisionInput,
  type StuckOrderRow,
} from './decision.repository.js';
