// utils.ts
// Common logic: generating tokens, checking expiry, storing offline time, etc.

import fs from 'fs';
import dayjs from 'dayjs';
import { ThreadChannel } from 'discord.js';

const OFFLINE_FILE = 'offline.json';

// Track which threads we have already submitted final results for
// so we don't spam the chain multiple times for the same thread.
const finalizedThreads = new Set<string>();

/**
 * Generate a short VoteToken from userId, threadId, and a secret.
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
 * Format an expiration date/time as "YYYY-MM-DD_HH-mm"
 */
export function formatExpirationDate(date: Date, hoursToAdd: number): string {
  return dayjs(date).add(hoursToAdd, 'hour').format('YYYY-MM-DD_HH-mm');
}

/**
 * Check if a thread name starts with e.g. "V:2025-02-01_15-30"
 * and parse the date/time to see if now is after that time.
 */
export function isExpired(threadName: string): boolean {
  // e.g. "V:2025-02-01_15-30: subject"
  // so parts[1] = "2025-02-01_15-30"
  const parts = threadName.split(':');
  if (parts.length < 2) return false;
  const dt = parts[1].trim();
  const maybe = dayjs(dt, 'YYYY-MM-DD_HH-mm');
  if (!maybe.isValid()) return false;
  return dayjs().isAfter(maybe);
}

/**
 * We consider the voting "finished" if votesCount >= totalParticipants
 * or if time is expired.
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
 * Mark a thread as "finalized" so we won't do repeated on-chain submissions.
 */
export function markThreadFinalized(threadId: string) {
  finalizedThreads.add(threadId);
}

/**
 * Check if a thread is already "finalized".
 */
export function isThreadFinalized(threadId: string): boolean {
  return finalizedThreads.has(threadId);
}

/**
 * Lock a thread (archive + locked).
 */
export async function lockThread(thread: ThreadChannel) {
  try {
    await thread.setLocked(true);
    await thread.setArchived(true);
  } catch {
    // ignore
  }
}

/**
 * Store offline timestamp in OFFLINE_FILE on shutdown
 */
export function storeOfflineTimestamp() {
  const now = new Date().toISOString();
  fs.writeFileSync(OFFLINE_FILE, JSON.stringify({ offlineAt: now }), 'utf-8');
}

/**
 * Read offline timestamp from OFFLINE_FILE
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

