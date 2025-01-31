// blockchain.ts
// Substrate / chain integration

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
let signer: any = null; // KeyringPair

/**
 * Initialize the Substrate chain connection (once).
 */
export async function initChain(endpoint: string, seedPhrase: string) {
  const provider = new WsProvider(endpoint);
  const _api = await ApiPromise.create({ provider });
  const _keyring = new Keyring({ type: 'sr25519' });
  const _signer = _keyring.addFromUri(seedPhrase);
  api = _api;
  signer = _signer;
  console.log(signer.address)
}

/**
 * Store results on chain with a remark transaction,
 * but if the account has no funds, we catch error
 * and throw to let the caller handle or message the user.
 */
export async function storeVotingResultsOnChain(
  payload: VotingResultsPayload
): Promise<void> {
  if (!api || !signer) {
    throw new Error('API or signer not initialized');
  }
  const remarkString = JSON.stringify(payload);
  const tx = remark(api, remarkString);
  await signAndSendTx(signer, tx); // can throw if no funds
}

