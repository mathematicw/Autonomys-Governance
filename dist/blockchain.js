"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initChain = initChain;
exports.initDrive = initDrive;
exports.storeVotingResultsOnChain = storeVotingResultsOnChain;
exports.retrieveVotingResults = retrieveVotingResults;
const api_1 = require("@polkadot/api");
const auto_drive_1 = require("@autonomys/auto-drive");
let api = null;
let signer = null; // Substrate KeyringPair
let driveApi = null; // Auto-drive API instance
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
 * initialization  Auto-drive API.
 */
async function initDrive() {
    driveApi = await (0, auto_drive_1.createAutoDriveApi)({
        apiKey: process.env.DRIVE_APIKEY,
        network: "taurus" // or "mainnet" if in mainnet
    });
    console.log('Auto-drive API initialized.');
}
/**
 * Save voting results on Auto-drive and return CID.
 *
 * @param payload - object VotingResultsPayload with voting data.
 * @returns CID as string.
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
 * Download voting results from Auto-drive
 *
 * @param cid - CID загруженного файла.
 * @returns Parsed VotingResultsPayload.
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
