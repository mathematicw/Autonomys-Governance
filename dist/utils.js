"use strict";
// src/utils.ts
// Common logic utilities used across the bot:
// - Generation of a short VoteToken based on a user ID, thread ID, and a secret.
// - Calculation of expiration dates for threads based on their creation time and a voting duration.
// - Storing and reading an offline timestamp from disk.
// - Tracking which threads have been finalized so that final results are not submitted more than once.
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
const fs_1 = __importDefault(require("fs"));
const dayjs_1 = __importDefault(require("dayjs"));
// The filename where the offline timestamp will be stored.
const OFFLINE_FILE = 'offline.json';
// A Set to track thread IDs for which final voting results have already been submitted.
// This prevents duplicate submission of final results.
const finalizedThreads = new Set();
/**
 * Generates a short VoteToken from a combination of the user ID, thread ID, and a secret.
 *
 * This token is used to uniquely identify a user's voting eligibility in a given thread.
 * The function creates a hash by iterating over the concatenated string and then converts
 * the absolute value of the hash to an 8-character hexadecimal string.
 *
 * @param userId - The Discord user ID.
 * @param threadId - The Discord thread ID.
 * @param secret - A secret string, typically provided via the VOTERID_SECRET environment variable.
 * @returns A short alphanumeric token as a string.
 */
function generateVoteToken(userId, threadId, secret) {
    const base = `${userId}:${threadId}:${secret}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
        // Bitwise operations to compute a simple hash value
        hash = (hash << 5) - hash + base.charCodeAt(i);
        hash |= 0;
    }
    // Convert the absolute hash value to a hexadecimal string and pad it to ensure a minimum length of 8 characters
    let hex = Math.abs(hash).toString(16).padStart(8, '0');
    // If the generated hex string is longer than 8 characters, trim it to 8 characters
    if (hex.length > 8)
        hex = hex.slice(0, 8);
    return hex;
}
/**
 * Formats a date by adding a specified number of hours and then outputs it in the "YYYY-MM-DD" format.
 *
 * This function is used to generate an expiration date for a thread based on the current time plus a voting duration.
 * The formatted date string is then used to construct the thread name.
 *
 * @param date - The base date (the current date).
 * @param hoursToAdd - The number of hours to add to the base date (the voting duration).
 * @returns A formatted date string in the format "YYYY-MM-DD".
 */
function formatExpirationDate(date, hoursToAdd) {
    return (0, dayjs_1.default)(date).add(hoursToAdd, 'hour').format('YYYY-MM-DD');
}
/**
 * Determines whether a thread has expired based on its creation time and the specified voting duration.
 *
 * The function compares the current time to the sum of the thread's creation time and the voting duration.
 *
 * @param thread - The Discord thread channel.
 * @param votingDurationHours - The duration of the voting period in hours.
 * @returns True if the current time is after the calculated expiration time; otherwise, false.
 */
function isExpiredThread(thread, votingDurationHours) {
    const creationTime = (0, dayjs_1.default)(thread.createdAt);
    const expirationTime = creationTime.add(votingDurationHours, 'hour');
    return (0, dayjs_1.default)().isAfter(expirationTime);
}
/**
 * Determines if the voting session is finished.
 *
 * Voting is considered finished if the total number of votes is at least equal to the total number of eligible participants,
 * or if the voting period has expired.
 *
 * @param votesCount - The total number of votes that have been cast.
 * @param totalParticipants - The total number of eligible participants.
 * @param timeExpired - A boolean indicating whether the voting duration has expired.
 * @returns True if voting is finished; otherwise, false.
 */
function isVotingFinished(votesCount, totalParticipants, timeExpired) {
    if (votesCount >= totalParticipants)
        return true;
    if (timeExpired)
        return true;
    return false;
}
/**
 * Mark a thread as finalized so that final results are not submitted more than once.
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
 * @returns True if the thread is already finalized.
 */
function isThreadFinalized(threadId) {
    return finalizedThreads.has(threadId);
}
/**
 * Lock a thread by setting it as locked and archiving it.
 * This is used to enforce that no further votes or messages are added after finalization.
 *
 * @param thread  - The Discord thread channel to lock.
 */
async function lockThread(thread) {
    try {
        await thread.setLocked(true);
        await thread.setArchived(true);
    }
    catch {
        // Ignore errors during locking  (e.g., insufficient permissions), ignore it.
    }
}
/**
 * Stores the current offline timestamp in a file.
 *
 * This function writes the current ISO timestamp to a local file (OFFLINE_FILE),
 * which can be used later to determine the period during which the bot was offline.
 */
function storeOfflineTimestamp() {
    const now = new Date().toISOString();
    fs_1.default.writeFileSync(OFFLINE_FILE, JSON.stringify({ offlineAt: now }), 'utf-8');
}
/**
 * Read the last offline timestamp from the file.
 *
 * @returns The offline timestamp as a string, or null if not found or cannot be parsed.
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
