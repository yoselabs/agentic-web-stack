/** Max events replayed on reconnect via tracked(). Over this → resync sentinel. */
export const ACTIVITY_REPLAY_GAP_MAX = 500;

/** Events older than this aren't replayed via tracked() even if under the gap cap. */
export const ACTIVITY_REPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Max events returned by the paginated list query. */
export const ACTIVITY_LIST_PAGE_SIZE = 50;
