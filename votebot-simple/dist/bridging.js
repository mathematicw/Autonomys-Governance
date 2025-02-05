"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swapEvmToSubstrate = swapEvmToSubstrate;
require("dotenv/config");
const api_1 = require("@polkadot/api");
const util_crypto_1 = require("@polkadot/util-crypto");
const bn_js_1 = __importDefault(require("bn.js"));
const ethers_1 = require("ethers");
const { SUBSTRATE_ENDPOINT, SEED_PHRASE } = process.env;
if (!SUBSTRATE_ENDPOINT || !SEED_PHRASE) {
    throw new Error('SUBSTRATE_ENDPOINT or SEED_PHRASE not set in .env');
}
/**
 * Function to swap test tokens from EVM to Substrate.
 * @param amountStr Amount in ETH units (e.g., "0.01").
 * @param substrateRecipient Substrate recipient address.
 */
async function swapEvmToSubstrate(amountStr, substrateRecipient) {
    // Connect to the Substrate node via WS endpoint
    const provider = new api_1.WsProvider(SUBSTRATE_ENDPOINT);
    const api = await api_1.ApiPromise.create({ provider });
    // Wait for cryptographic libraries to be ready
    await (0, util_crypto_1.cryptoWaitReady)();
    // Initialize keyring and add account from mnemonic (sr25519)
    const keyring = new api_1.Keyring({ type: 'sr25519' });
    const account = keyring.addFromMnemonic(SEED_PHRASE);
    // Convert the amount from ETH (in wei) to BN (using 18 decimals)
    const amountWei = ethers_1.ethers.parseEther(amountStr); // ethers.BigNumber
    const amountBN = new bn_js_1.default(amountWei.toString());
    console.log(`Sending ${amountStr} tokens to ${substrateRecipient}...`);
    // Inspect available methods in the 'messenger' pallet
    const messengerMethods = Object.keys(api.tx.messenger);
    console.log('Available messenger methods:', messengerMethods);
    // IMPORTANT:
    // Do not assume the extrinsic is named "swap". Replace 'swap' below with the actual method name
    // as provided in your chain's metadata.
    const methodName = 'swap'; // <-- измените, если название отличается
    if (typeof api.tx.messenger[methodName] !== 'function') {
        throw new Error(`Extrinsic method "${methodName}" not found in messenger pallet. Available methods: ${messengerMethods.join(', ')}`);
    }
    // Create the extrinsic using the (assumed) correct method
    const extrinsic = api.tx.messenger[methodName](amountBN, substrateRecipient);
    // Sign and send the extrinsic using the Substrate account
    return new Promise(async (resolve, reject) => {
        const unsub = await extrinsic.signAndSend(account, (result) => {
            console.log(`Current status: ${result.status}`);
            if (result.status.isInBlock) {
                console.log(`Transaction included in block: ${result.status.asInBlock.toString()}`);
            }
            else if (result.status.isFinalized) {
                console.log(`Transaction finalized in block: ${result.status.asFinalized.toString()}`);
                // Check that unsub is callable before calling it
                if (typeof unsub === 'function') {
                    unsub();
                }
                resolve();
            }
        }).catch((err) => {
            console.error('Error sending extrinsic:', err);
            reject(err);
        });
    });
}
// Example call (adjust parameters as needed)
swapEvmToSubstrate("0.01", "5G9Qa...")
    .catch((err) => {
    console.error('Error bridging tokens:', err);
    process.exit(1);
});
