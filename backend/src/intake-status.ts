export interface IntakeStatus {
  github: 'implemented';
  repositoryDiscovery: 'implemented';
  repositorySnapshot: 'implemented';
  stackDetection: 'implemented';
  baselineChecks: 'not_implemented';
  aiAnalysis: 'not_available';
}

export function getIntakeStatus(): IntakeStatus {
  return {
    github: 'implemented',
    repositoryDiscovery: 'implemented',
    repositorySnapshot: 'implemented',
    stackDetection: 'implemented',
    baselineChecks: 'not_implemented',
    aiAnalysis: 'not_available',
  };
}
