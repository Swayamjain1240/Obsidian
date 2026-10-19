import { randomUUID } from 'node:crypto';

import type { CompletenessArea } from '../completeness/types.js';
import type { Recommendation } from './types.js';

export function buildRecommendationCatalog(enhancementRunId: string, areas: readonly CompletenessArea[], scopeMode: 'FULL' | 'EXISTING_ONLY'): Recommendation[] {
  return areas
    .filter((area) => area.status !== 'not_available')
    .filter((area) => !(scopeMode === 'EXISTING_ONLY' && ['not_implemented', 'placeholder'].includes(area.status)))
    .map((area) => ({
      id: randomUUID(),
      enhancementRunId,
      category: area.id === 'tests' ? 'testing' : area.id === 'documentation' ? 'documentation' : 'architecture',
      title: `Review ${area.name}`,
      currentProblem: area.summary,
      suggestedSolution: 'Review and improve this existing area without inventing absent product features.',
      risk: area.status === 'working' ? 'low' : 'medium',
      affectedPaths: [...area.affectedPaths],
      affectedAreas: [area.id],
      affectedSymbols: [],
      evidenceRefs: area.affectedPaths.map((path) => ({ path, reason: `Completeness area ${area.name} selected.` })),
      impact: { behavior: area.summary },
      expectedTests: ['Baseline and affected-area checks'],
      approvalState: 'awaiting_approval' as const,
      operations: [],
    }));
}
