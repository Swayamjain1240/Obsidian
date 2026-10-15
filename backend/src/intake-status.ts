export interface IntakeStatus {
  github: 'implemented';
  repositoryDiscovery: 'implemented';
  repositorySnapshot: 'implemented';
  stackDetection: 'implemented';
  completeness: 'implemented';
  baselineChecks: 'implemented';
  aiAnalysis: 'not_available';
}

export function getIntakeStatus(): IntakeStatus {
  return {
    github: 'implemented',
    repositoryDiscovery: 'implemented',
    repositorySnapshot: 'implemented',
    stackDetection: 'implemented',
    completeness: 'implemented',
    baselineChecks: 'implemented',
    aiAnalysis: 'not_available',
  };
}
