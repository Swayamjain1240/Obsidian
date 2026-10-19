
import type { BaselineCommandSpec } from '../baseline/adapters.js';
import type {
  BaselineCommandResult,
  BaselineCommandRunnerOptions,
} from '../baseline/runner.js';

/**
 * Contract for executing repository validation commands.
 * Implementations must enforce their own execution security policy.
 */
export interface RepositoryCommandExecutor {
  run(
    command: BaselineCommandSpec,
    options: BaselineCommandRunnerOptions,
  ): Promise<BaselineCommandResult>;
}
