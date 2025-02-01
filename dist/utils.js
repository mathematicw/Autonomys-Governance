"use strict";
// src/utils.ts
// Common logic: token generation, expiration checking, offline timestamp storage,
// and thread finalization tracking.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVoteToken = generateVoteToken;
exports.formatExpirationDate = formatExpirationDate;
exports.isExpiredThread = isExpiredThread;
exports.isVotingFinished = isVotingFinished;
exports.markThreadFinalized = markThreadFinalized;
exports.isThreadFinalized = isThreadFinalized;
exports.lockThread = lockThread;
exports.storeOfflineTimestamp = storeOfflineTimestamp;
exports.readOfflineTimestamp = readOfflineTimestamp;
// Import required modules.
const fs_1 = __importDefault(require("fs"));
const dayjs_1 = __importDefault(require("dayjs"));
const OFFLINE_FILE = 'offline.json';
// A Set to track threads for which final results have been submitted.
const finalizedThreads = new Set();
/**
 * Generate a short VoteToken based on userId, threadId, and a secret.
 *
 * @param userId - The Discord user ID.
 * @param threadId - The Discord thread ID.
 * @param secret - The secret string (from .env VOTERID_SECRET).
 * @returns A short alphanumeric token.
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
 * Format an expiration date as "YYYY-MM-DD".
 * This is used to construct the thread name.
 *
 * @param date - The current date.
 * @param hoursToAdd - The voting duration in hours.
 * @returns A string in the format "YYYY-MM-DD".
 */
function formatExpirationDate(date, hoursToAdd) {
    return (0, dayjs_1.default)(date).add(hoursToAdd, 'hour').format('YYYY-MM-DD');
}
/**
 * Check if a thread has expired.
 * Instead of parsing the date from the thread name, we use the thread's creation time.
 *
 * @param thread - The Discord thread channel.
 * @param votingDurationHours - The voting duration in hours (from .env).
 * @returns True if the current time is after (thread.createdAt + votingDurationHours).
 */
function isExpiredThread(thread, votingDurationHours) {
    const creationTime = (0, dayjs_1.default)(thread.createdAt);
    const expirationTime = creationTime.add(votingDurationHours, 'hour');
    return (0, dayjs_1.default)().isAfter(expirationTime);
}
/**
 * Determine if voting is finished.
 * Voting is finished if total votes are at least equal to total participants or time has expired.
 *
 * @param votesCount - Total number of votes recorded.
 * @param totalParticipants - Total number of eligible participants.
 * @param timeExpired - Boolean indicating if the voting duration has expired.
 * @returns True if voting is finished.
 */
function isVotingFinished(votesCount, totalParticipants, timeExpired) {
    if (votesCount >= totalParticipants)
        return true;
    if (timeExpired)
        return true;
    return false;
}
/**
 * Mark a thread as finalized to prevent duplicate on-chain submissions.
 *
 * @param threadId - The ID of the thread.
 */
function markThreadFinalized(threadId) {
    finalizedThreads.add(threadId);
}
/**
 * Check if a thread has already been finalized.
 *
 * @param threadId - The ID of the thread.
 * @returns True if the thread is marked as finalized.
 */
function isThreadFinalized(threadId) {
    return finalizedThreads.has(threadId);
}
/**
 * Lock a thread by setting it as locked and archiving it.
 *
 * @param thread - The Discord thread channel.
 */
async function lockThread(thread) {
    try {
        await thread.setLocked(true);
        await thread.setArchived(true);
    }
    catch {
        // Ignore errors during locking.
    }
}
/**
 * Store the current offline timestamp to a file.
 */
function storeOfflineTimestamp() {
    const now = new Date().toISOString();
    fs_1.default.writeFileSync(OFFLINE_FILE, JSON.stringify({ offlineAt: now }), 'utf-8');
}
/**
 * Read the last offline timestamp from a file.
 *
 * @returns The offline timestamp as a string, or null if not found.
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
