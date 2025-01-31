"use strict";
// utils.ts
// Common logic: generating tokens, checking expiry, storing offline time, etc.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVoteToken = generateVoteToken;
exports.formatExpirationDate = formatExpirationDate;
exports.isExpired = isExpired;
exports.isVotingFinished = isVotingFinished;
exports.markThreadFinalized = markThreadFinalized;
exports.isThreadFinalized = isThreadFinalized;
exports.lockThread = lockThread;
exports.storeOfflineTimestamp = storeOfflineTimestamp;
exports.readOfflineTimestamp = readOfflineTimestamp;
const fs_1 = __importDefault(require("fs"));
const dayjs_1 = __importDefault(require("dayjs"));
const OFFLINE_FILE = 'offline.json';
// Track which threads we have already submitted final results for
// so we don't spam the chain multiple times for the same thread.
const finalizedThreads = new Set();
/**
 * Generate a short VoteToken from userId, threadId, and a secret.
 */
function generateVoteToken(userId, threadId, secret) {
    const base = `${userId}:${threadId}:${secret}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
        hash = (hash << 5) - hash + base.charCodeAt(i);
        hash |= 0;
    }
    let hex = Math.abs(hash).toString(16).padStart(8, '0');
    if (hex.length > 8)
        hex = hex.slice(0, 8);
    return hex;
}
/**
 * Format an expiration date/time as "YYYY-MM-DD_HH-mm"
 */
function formatExpirationDate(date, hoursToAdd) {
    return (0, dayjs_1.default)(date).add(hoursToAdd, 'hour').format('YYYY-MM-DD_HH-mm');
}
/**
 * Check if a thread name starts with e.g. "V:2025-02-01_15-30"
 * and parse the date/time to see if now is after that time.
 */
function isExpired(threadName) {
    // e.g. "V:2025-02-01_15-30: subject"
    // so parts[1] = "2025-02-01_15-30"
    const parts = threadName.split(':');
    if (parts.length < 2)
        return false;
    const dt = parts[1].trim();
    const maybe = (0, dayjs_1.default)(dt, 'YYYY-MM-DD_HH-mm');
    if (!maybe.isValid())
        return false;
    return (0, dayjs_1.default)().isAfter(maybe);
}
/**
 * We consider the voting "finished" if votesCount >= totalParticipants
 * or if time is expired.
 */
function isVotingFinished(votesCount, totalParticipants, timeExpired) {
    if (votesCount >= totalParticipants)
        return true;
    if (timeExpired)
        return true;
    return false;
}
/**
 * Mark a thread as "finalized" so we won't do repeated on-chain submissions.
 */
function markThreadFinalized(threadId) {
    finalizedThreads.add(threadId);
}
/**
 * Check if a thread is already "finalized".
 */
function isThreadFinalized(threadId) {
    return finalizedThreads.has(threadId);
}
/**
 * Lock a thread (archive + locked).
 */
async function lockThread(thread) {
    try {
        await thread.setLocked(true);
        await thread.setArchived(true);
    }
    catch {
        // ignore
    }
}
/**
 * Store offline timestamp in OFFLINE_FILE on shutdown
 */
function storeOfflineTimestamp() {
    const now = new Date().toISOString();
    fs_1.default.writeFileSync(OFFLINE_FILE, JSON.stringify({ offlineAt: now }), 'utf-8');
}
/**
 * Read offline timestamp from OFFLINE_FILE
 */
function readOfflineTimestamp() {
    try {
        const data = fs_1.default.readFileSync(OFFLINE_FILE, 'utf-8');
        const json = JSON.parse(data);
        return json.offlineAt || null;
    }
    catch {
        return null;
    }
}
