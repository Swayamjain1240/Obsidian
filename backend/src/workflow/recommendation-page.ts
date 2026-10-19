import type { Recommendation } from './types.js';

export function pageRecommendations(recommendations: readonly Recommendation[], page = 1, perPage = 5): { recommendations: Recommendation[]; page: number; perPage: number; total: number } {
  const safePage = Math.max(1, Math.min(10_000, Math.trunc(page)));
  const safePerPage = Math.max(1, Math.min(20, Math.trunc(perPage)));
  const start = (safePage - 1) * safePerPage;
  return { recommendations: recommendations.slice(start, start + safePerPage).map((recommendation) => ({ ...recommendation, affectedPaths: [...recommendation.affectedPaths], affectedAreas: [...recommendation.affectedAreas], expectedTests: [...recommendation.expectedTests], operations: recommendation.operations.map((operation) => ({ ...operation })) })), page: safePage, perPage: safePerPage, total: recommendations.length };
}
