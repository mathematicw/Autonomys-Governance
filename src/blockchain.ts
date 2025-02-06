import { ApiPromise, WsProvider, Keyring } from '@polkadot/api';
import { signAndSendTx } from '@autonomys/auto-utils';
import { createAutoDriveApi, uploadFile, downloadFile } from '@autonomys/auto-drive';
import { NetworkId } from '@autonomys/auto-utils';

/**
 * VotingResultsPayload describes the structure of the final voting results data.
 */
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
let signer: any = null; // Substrate KeyringPair used for signing transactions
let driveApi: any = null; // Auto-drive API instance used for file storage

// GenericFile interface as expected by the uploadFile function.
// The read() method returns an AsyncIterable<Buffer> containing the file data.
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
 * Initializes the Auto-drive API.
 *
 * This function uses the DRIVE_APIKEY environment variable (set in .env).
 * The Auto-drive API is used for storing and retrieving files (voting results).
 *
 * Note: The network parameter is cast to "taurus" as required by the ConnectionOptions.
 *
 * @returns A promise that resolves when the Auto-drive API is initialized.
 */
export async function initDrive(): Promise<void> {
  driveApi = await createAutoDriveApi({ 
    apiKey: process.env.DRIVE_APIKEY,
    network: "taurus" as "taurus" // or "mainnet" if in mainnet
  });
  console.log('Auto-drive API initialized.');
}

/**
 * Stores the final voting results on Auto-drive and returns the resulting CID.
 *
 * This function converts the VotingResultsPayload into a JSON string,
 * wraps it in a GenericFile object, and uploads it to Auto-drive using the uploadFile function.
 *
 * @param payload - The final voting results data.
 * @returns The CID (Content Identifier) of the stored file as a string.
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
 * Retrieves the voting results from Auto-drive using the given CID.
 *
 * This function downloads the file as an async iterable of Buffer chunks,
 * concatenates them into a single Buffer, converts it into a UTF-8 string,
 * and parses the JSON to return a VotingResultsPayload object.
 *
 * @param cid - The CID of the stored voting results file.
 * @returns The parsed VotingResultsPayload.
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

