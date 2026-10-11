export interface IntakeStatus {
  github: 'not_implemented';
  repositoryDiscovery: 'not_implemented';
  repositorySnapshot: 'implemented';
  stackDetection: 'not_implemented';
  baselineChecks: 'not_implemented';
  aiAnalysis: 'not_available';
}

export function getIntakeStatus(): IntakeStatus {
  return {
    github: 'not_implemented',
    repositoryDiscovery: 'not_implemented',
    repositorySnapshot: 'implemented',
    stackDetection: 'not_implemented',
    baselineChecks: 'not_implemented',
    aiAnalysis: 'not_available',
  };
}
