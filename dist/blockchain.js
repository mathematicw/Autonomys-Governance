"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initChain = initChain;
exports.initDrive = initDrive;
exports.storeVotingResultsOnChain = storeVotingResultsOnChain;
exports.retrieveVotingResults = retrieveVotingResults;
const api_1 = require("@polkadot/api");
const auto_drive_1 = require("@autonomys/auto-drive");
let api = null;
let signer = null; // Substrate KeyringPair used for signing transactions
let driveApi = null; // Auto-drive API instance used for file storage
/**
 * Init connection to Substrate.
 *
 * @param endpoint - RPC endpoint Substrate.
 * @param seedPhrase - wallet Seed phrase.
 */
async function initChain(endpoint, seedPhrase) {
    const provider = new api_1.WsProvider(endpoint);
    api = await api_1.ApiPromise.create({ provider });
    const keyring = new api_1.Keyring({ type: 'sr25519' });
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
async function initDrive() {
    driveApi = await (0, auto_drive_1.createAutoDriveApi)({
        apiKey: process.env.DRIVE_APIKEY,
        network: "taurus" // or "mainnet" if in mainnet
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
async function storeVotingResultsOnChain(payload) {
    if (!driveApi) {
        throw new Error('Drive API not initialized');
    }
    const data = JSON.stringify(payload);
    const file = {
        name: 'voting-results.json',
        size: Buffer.from(data).length,
        read: () => {
            async function* generator() {
                yield Buffer.from(data);
            }
            return generator();
        }
    };
    const cid = await (0, auto_drive_1.uploadFile)(driveApi, file, { compression: true });
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
async function retrieveVotingResults(cid) {
    if (!driveApi) {
        throw new Error('Drive API not initialized');
    }
    const stream = await (0, auto_drive_1.downloadFile)(driveApi, cid);
    let fileData = Buffer.alloc(0);
    for await (const chunk of stream) {
        fileData = Buffer.concat([fileData, chunk]);
    }
    const jsonString = fileData.toString('utf-8');
    return JSON.parse(jsonString);
}
