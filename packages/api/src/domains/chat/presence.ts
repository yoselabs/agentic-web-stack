import { roomChannel } from "./channels.js";
import { PRESENCE_LEAVE_GRACE_MS } from "./constants.js";

const rooms = new Map<string, Set<string>>();
const pendingLeave = new Map<string, NodeJS.Timeout>();

function keyOf(roomId: string, userId: string) {
  return `${roomId}:${userId}`;
}

export function presenceList(roomId: string): string[] {
  return Array.from(rooms.get(roomId) ?? []);
}

export function isUserInRoom(roomId: string, userId: string): boolean {
  return rooms.get(roomId)?.has(userId) ?? false;
}

export function presenceEnter(roomId: string, userId: string): void {
  const key = keyOf(roomId, userId);
  const pending = pendingLeave.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingLeave.delete(key);
    return; // cancel the leave; user is effectively already present
  }
  let set = rooms.get(roomId);
  if (!set) {
    set = new Set();
    rooms.set(roomId, set);
  }
  set.add(userId);
  roomChannel.publish(roomId, "presence:enter", { roomId, userId });
}

export function presenceLeave(roomId: string, userId: string): void {
  const key = keyOf(roomId, userId);
  const t = setTimeout(() => {
    rooms.get(roomId)?.delete(userId);
    pendingLeave.delete(key);
    roomChannel.publish(roomId, "presence:leave", { roomId, userId });
  }, PRESENCE_LEAVE_GRACE_MS);
  pendingLeave.set(key, t);
}
