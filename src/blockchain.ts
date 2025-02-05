import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { signAndSendTx } from '@autonomys/auto-utils';
import { createAutoDriveApi, uploadFile, downloadFile } from '@autonomys/auto-drive';
import { NetworkId } from '@autonomys/auto-utils';

export interface VotingResultsPayload {
  votingThreadId: string;
  dateOfCreating: string;
  fullThreadName: string;
  eligibleCount: number;
  allEligibleMembers: string[];
  votes: string; // e.g., "FOR: 2, AGAINST: 3, ABSTAIN: 0"
  missedDeadline: boolean;
  votingFinished: boolean;
}

let api: ApiPromise | null = null;
let signer: any = null; // Substrate KeyringPair
let driveApi: any = null; // Auto-drive API instance

// method read() returns AsyncIterable<Buffer>.
interface GenericFile {
  name: string;
  size: number;
  read: () => AsyncIterable<Buffer>;
}

/**
 * Init connection to Substrate.
 *
 * @param endpoint - RPC endpoint Substrate.
 * @param seedPhrase - wallet Seed phrase.
 */
export async function initChain(endpoint: string, seedPhrase: string): Promise<void> {
  const provider = new WsProvider(endpoint);
  api = await ApiPromise.create({ provider });
  const keyring = new Keyring({ type: 'sr25519' });
  signer = keyring.addFromUri(seedPhrase);
  console.log('Substrate signing address:', signer.address);
}

/**
 * initialization  Auto-drive API.
 */
export async function initDrive(): Promise<void> {
  driveApi = await createAutoDriveApi({ 
    apiKey: process.env.DRIVE_APIKEY,
    network: "taurus" as "taurus" // or "mainnet" if in mainnet
  });
  console.log('Auto-drive API initialized.');
}

/**
 * Save voting results on Auto-drive and return CID.
 *
 * @param payload - object VotingResultsPayload with voting data.
 * @returns CID as string.
 */
export async function storeVotingResultsOnChain(
  payload: VotingResultsPayload
): Promise<string> {
  if (!driveApi) {
    throw new Error('Drive API not initialized');
  }
  const data = JSON.stringify(payload);
  const file: GenericFile = {
    name: 'voting-results.json',
    size: Buffer.from(data).length,
    read: () => {
      async function* generator() {
        yield Buffer.from(data);
      }
      return generator();
    }
  };
  const cid = await uploadFile(driveApi, file, { compression: true });
  console.log('Voting results stored on drive, CID:', cid);
  return cid;
}

/**
 * Download voting results from Auto-drive
 *
 * @param cid - CID загруженного файла.
 * @returns Parsed VotingResultsPayload.
 */
export async function retrieveVotingResults(cid: string): Promise<VotingResultsPayload> {
  if (!driveApi) {
    throw new Error('Drive API not initialized');
  }
  const stream = await downloadFile(driveApi, cid);
  let fileData = Buffer.alloc(0);
  for await (const chunk of stream) {
    fileData = Buffer.concat([fileData, chunk]);
  }
  const jsonString = fileData.toString('utf-8');
  return JSON.parse(jsonString) as VotingResultsPayload;
}

