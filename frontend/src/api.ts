export interface IntakeStatus {
  github: 'not_implemented';
  repositoryDiscovery: 'not_implemented';
  stackDetection: 'not_implemented';
  baselineChecks: 'not_implemented';
  aiAnalysis: 'not_available';
}

export async function fetchIntakeStatus(): Promise<IntakeStatus> {
  const response = await fetch('/api/v1/status');

  if (!response.ok) {
    throw new Error('Backend status is unavailable.');
  }

  const payload = (await response.json()) as { status: IntakeStatus };
  return payload.status;
}
