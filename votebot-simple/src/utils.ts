// src/utils.ts
// Common logic: token generation, expiration checking, offline timestamp storage,
// and thread finalization tracking.

// Import required modules.
import fs from 'fs';
import dayjs from 'dayjs';
import { ThreadChannel } from 'discord.js';

const OFFLINE_FILE = 'offline.json';

// A Set to track threads for which final results have been submitted.
const finalizedThreads = new Set<string>();

/**
 * Generate a short VoteToken based on userId, threadId, and a secret.
 *
 * @param userId - The Discord user ID.
 * @param threadId - The Discord thread ID.
 * @param secret - The secret string (from .env VOTERID_SECRET).
 * @returns A short alphanumeric token.
 */
export function generateVoteToken(
  userId: string,
  threadId: string,
  secret: string
): string {
  const base = `${userId}:${threadId}:${secret}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash << 5) - hash + base.charCodeAt(i);
    hash |= 0;
  }
  let hex = Math.abs(hash).toString(16).padStart(8, '0');
  if (hex.length > 8) hex = hex.slice(0, 8);
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
export function formatExpirationDate(date: Date, hoursToAdd: number): string {
  return dayjs(date).add(hoursToAdd, 'hour').format('YYYY-MM-DD');
}

/**
 * Check if a thread has expired.
 * Instead of parsing the date from the thread name, we use the thread's creation time.
 *
 * @param thread - The Discord thread channel.
 * @param votingDurationHours - The voting duration in hours (from .env).
 * @returns True if the current time is after (thread.createdAt + votingDurationHours).
 */
export function isExpiredThread(thread: ThreadChannel, votingDurationHours: number): boolean {
  const creationTime = dayjs(thread.createdAt);
  const expirationTime = creationTime.add(votingDurationHours, 'hour');
  return dayjs().isAfter(expirationTime);
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
export function isVotingFinished(
  votesCount: number,
  totalParticipants: number,
  timeExpired: boolean
): boolean {
  if (votesCount >= totalParticipants) return true;
  if (timeExpired) return true;
  return false;
}

/**
 * Mark a thread as finalized to prevent duplicate on-chain submissions.
 *
 * @param threadId - The ID of the thread.
 */
export function markThreadFinalized(threadId: string) {
  finalizedThreads.add(threadId);
}

/**
 * Check if a thread has already been finalized.
 *
 * @param threadId - The ID of the thread.
 * @returns True if the thread is marked as finalized.
 */
export function isThreadFinalized(threadId: string): boolean {
  return finalizedThreads.has(threadId);
}

/**
 * Lock a thread by setting it as locked and archiving it.
 *
 * @param thread - The Discord thread channel.
 */
export async function lockThread(thread: ThreadChannel) {
  try {
    await thread.setLocked(true);
    await thread.setArchived(true);
  } catch {
    // Ignore errors during locking.
  }
}

/**
 * Store the current offline timestamp to a file.
 */
export function storeOfflineTimestamp() {
  const now = new Date().toISOString();
  fs.writeFileSync(OFFLINE_FILE, JSON.stringify({ offlineAt: now }), 'utf-8');
}

/**
 * Read the last offline timestamp from a file.
 *
 * @returns The offline timestamp as a string, or null if not found.
 */
export function readOfflineTimestamp(): string | null {
  try {
    const data = fs.readFileSync(OFFLINE_FILE, 'utf-8');
    const json = JSON.parse(data);
    return json.offlineAt || null;
  } catch {
    return null;
  }
}

