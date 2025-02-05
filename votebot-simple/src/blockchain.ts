// src/blockchain.ts
// Substrate chain integration: initialize connection and submit final voting results on-chain via a remark transaction.

import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { remark } from '@autonomys/auto-consensus';
import { signAndSendTx } from '@autonomys/auto-utils';

export interface VotingResultsPayload {
  votingThreadId: string;
  dateOfCreating: string;
  fullThreadName: string;
  eligibleCount: number;
  allEligibleMembers: string[];
  votes: string; // e.g. "FOR: 2, AGAINST: 3, ABSTAIN: 0"
  missedDeadline: boolean;
  votingFinished: boolean;
}

let api: ApiPromise | null = null;
let signer: any = null; // Substrate KeyringPair

/**
 * Initialize the Substrate chain connection.
 *
 * @param endpoint - The Substrate RPC endpoint.
 * @param seedPhrase - The seed phrase for the signing account.
 */
export async function initChain(endpoint: string, seedPhrase: string) {
  const provider = new WsProvider(endpoint);
  const _api = await ApiPromise.create({ provider });
  const _keyring = new Keyring({ type: 'sr25519' });
  const _signer = _keyring.addFromUri(seedPhrase);
  api = _api;
  signer = _signer;
  console.log('Substrate signing address:', signer.address);
}

/**
 * Submit final voting results on-chain via a remark transaction.
 * Throws an error if the account has insufficient funds.
 *
 * @param payload - The voting results payload.
 */
export async function storeVotingResultsOnChain(
  payload: VotingResultsPayload
): Promise<void> {
  if (!api || !signer) {
    throw new Error('API or signer not initialized');
  }
  const remarkString = JSON.stringify(payload);
  const tx = remark(api, remarkString);
  await signAndSendTx(signer, tx);
}

