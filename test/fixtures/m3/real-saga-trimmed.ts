// Trimmed and adapted from temporalio/samples-typescript, saga/src/workflows.ts.
// Source: https://github.com/temporalio/samples-typescript/blob/main/saga/src/workflows.ts
// License: MIT, confirmed at https://github.com/temporalio/samples-typescript/blob/main/LICENSE
// (fetched directly and verified before this fixture was written).
//
// Adapted to be self-contained for this test fixture: the external
// `./types/workflow-commands` type import and unrelated error-formatting
// helper were removed, but the real structural pattern this fixture exists
// to test — destructured `proxyActivities()`, try/catch around activity
// calls, and a non-exported compensation helper — is preserved unchanged
// from the original sample.

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './fake-saga-activities';

const { createAccount, addAddress, addBankAccount, disconnectBankAccounts } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2s',
});

interface OpenAccountParams {
  accountId: string;
  address: string;
}

interface Compensation {
  fn: () => Promise<void>;
}

export async function openAccount(params: OpenAccountParams): Promise<void> {
  const compensations: Compensation[] = [];

  try {
    await createAccount({ accountId: params.accountId });
  } catch (err) {
    // this is fatal so fails fast; no compensations are needed
    throw err;
  }

  try {
    await addAddress({ accountId: params.accountId, address: params.address });
    await addBankAccount({ accountId: params.accountId });
    compensations.unshift({ fn: () => disconnectBankAccounts({ accountId: params.accountId }) });
  } catch (err) {
    await compensate(compensations);
    throw err;
  }
}

async function compensate(compensations: Compensation[]): Promise<void> {
  for (const comp of compensations) {
    try {
      await comp.fn();
    } catch (err) {
      // swallow errors during compensation, matching the original sample
    }
  }
}
