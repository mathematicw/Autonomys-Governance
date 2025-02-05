"use strict";
// src/blockchain.ts
// Substrate chain integration: initialize connection and submit final voting results on-chain via a remark transaction.
Object.defineProperty(exports, "__esModule", { value: true });
exports.initChain = initChain;
exports.storeVotingResultsOnChain = storeVotingResultsOnChain;
const api_1 = require("@polkadot/api");
const auto_consensus_1 = require("@autonomys/auto-consensus");
const auto_utils_1 = require("@autonomys/auto-utils");
let api = null;
let signer = null; // Substrate KeyringPair
/**
 * Initialize the Substrate chain connection.
 *
 * @param endpoint - The Substrate RPC endpoint.
 * @param seedPhrase - The seed phrase for the signing account.
 */
async function initChain(endpoint, seedPhrase) {
    const provider = new api_1.WsProvider(endpoint);
    const _api = await api_1.ApiPromise.create({ provider });
    const _keyring = new api_1.Keyring({ type: 'sr25519' });
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
async function storeVotingResultsOnChain(payload) {
    if (!api || !signer) {
        throw new Error('API or signer not initialized');
    }
    const remarkString = JSON.stringify(payload);
    const tx = (0, auto_consensus_1.remark)(api, remarkString);
    await (0, auto_utils_1.signAndSendTx)(signer, tx);
}
