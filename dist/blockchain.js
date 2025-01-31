"use strict";
// blockchain.ts
// Substrate / chain integration
Object.defineProperty(exports, "__esModule", { value: true });
exports.initChain = initChain;
exports.storeVotingResultsOnChain = storeVotingResultsOnChain;
const api_1 = require("@polkadot/api");
const auto_consensus_1 = require("@autonomys/auto-consensus");
const auto_utils_1 = require("@autonomys/auto-utils");
let api = null;
let signer = null; // KeyringPair
/**
 * Initialize the Substrate chain connection (once).
 */
async function initChain(endpoint, seedPhrase) {
    const provider = new api_1.WsProvider(endpoint);
    const _api = await api_1.ApiPromise.create({ provider });
    const _keyring = new api_1.Keyring({ type: 'sr25519' });
    const _signer = _keyring.addFromUri(seedPhrase);
    api = _api;
    signer = _signer;
    console.log(signer.address);
}
/**
 * Store results on chain with a remark transaction,
 * but if the account has no funds, we catch error
 * and throw to let the caller handle or message the user.
 */
async function storeVotingResultsOnChain(payload) {
    if (!api || !signer) {
        throw new Error('API or signer not initialized');
    }
    const remarkString = JSON.stringify(payload);
    const tx = (0, auto_consensus_1.remark)(api, remarkString);
    await (0, auto_utils_1.signAndSendTx)(signer, tx); // can throw if no funds
}
