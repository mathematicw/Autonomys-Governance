"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ethers_1 = require("ethers");
const util_crypto_1 = require("@polkadot/util-crypto");
/*
Usage:
  1) .env:
       EVM_ENDPOINT="https://someEVMrpc" or wss://...
       SEED_PHRASE="some mnemonic"
  2) npx ts-node bridging.ts <amountInETH> <substrateRecipient>

Example:
   npx ts-node bridging.ts 0.01 5G9Qa...
*/
const { EVM_ENDPOINT, SEED_PHRASE } = process.env;
const [, , amountArg, substrateRecipient] = process.argv;
if (!amountArg || !substrateRecipient) {
    console.error('Usage: npx ts-node bridging.ts <amountInETH> <substrateRecipient>');
    process.exit(1);
}
/**
 * Derive EVM private key from same mnemonic used for sr25519 in polkadot.js
 * This may or may not match your actual EVM wallet derivation if you used e.g. Metamask.
 */
function deriveEvmPrivateKey(mnemonic) {
    const miniSecret = (0, util_crypto_1.mnemonicToMiniSecret)(mnemonic); // 32 bytes
    const pair = (0, util_crypto_1.secp256k1PairFromSeed)(miniSecret); // 64-byte secret
    const privKey = pair.secretKey.slice(0, 32); // first 32 bytes -> real private key
    return '0x' + Buffer.from(privKey).toString('hex');
}
async function main() {
    if (!EVM_ENDPOINT || !SEED_PHRASE) {
        throw new Error('EVM_ENDPOINT or SEED_PHRASE not set in .env');
    }
    console.log('EVM endpoint:', EVM_ENDPOINT);
    // 1) derive private key
    const privateKey = deriveEvmPrivateKey(SEED_PHRASE);
    console.log('Derived EVM private key:', privateKey);
    // 2) create provider & wallet
    const provider = new ethers_1.ethers.JsonRpcProvider(EVM_ENDPOINT);
    const wallet = new ethers_1.ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    console.log('EVM address:', walletAddress);
    // 3) get balance
    const balance = await provider.getBalance(walletAddress);
    console.log('Current wallet balance:', ethers_1.ethers.formatEther(balance));
    // 4) parse the amount to send
    const amountWei = ethers_1.ethers.parseEther(amountArg);
    console.log(`Sending ${amountArg} to ${substrateRecipient}...`);
    // 5) send tx
    const tx = await wallet.sendTransaction({
        to: substrateRecipient,
        value: amountWei
    });
    console.log('Tx hash:', tx.hash);
    // 6) wait for confirmation
    await tx.wait();
    console.log('Transaction confirmed!');
}
main().catch((err) => {
    console.error('Error bridging tokens:', err);
    process.exit(1);
});
