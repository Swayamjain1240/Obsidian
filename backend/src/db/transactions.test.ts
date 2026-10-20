import { describe, expect, it } from 'vitest';

import { DatabaseTransactionUnavailableError, withMongoTransaction } from './transactions.js';

describe('MongoDB transaction boundary', () => {
  it('fails closed before starting a transaction without replica-set capability', async () => {
    await expect(withMongoTransaction(async () => 'unexpected')).rejects.toBeInstanceOf(DatabaseTransactionUnavailableError);
  });
});
