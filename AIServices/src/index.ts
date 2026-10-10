export type AiProvider = 'disabled' | 'custom';

export interface AiRequest {
  operation: 'analyze' | 'recommend';
  input: string;
  timeoutMs: number;
}

export interface AiResult {
  status: 'unavailable' | 'completed' | 'failed';
  provider: AiProvider;
  message: string;
  output?: string;
}

export interface AiService {
  run(request: AiRequest): Promise<AiResult>;
}

export class DisabledAiService implements AiService {
  async run(_request: AiRequest): Promise<AiResult> {
    return {
      status: 'unavailable',
      provider: 'disabled',
      message: 'AI services are not configured for this environment.',
    };
  }
}

export function createAiService(provider: AiProvider = 'disabled'): AiService {
  if (provider === 'disabled') {
    return new DisabledAiService();
  }

  throw new Error(`AI provider is not implemented: ${provider}`);
}
