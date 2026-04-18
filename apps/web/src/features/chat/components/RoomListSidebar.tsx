import { Link } from "@tanstack/react-router";
import type { ChatRoomSummary } from "../types";

type Props = {
  rooms: ChatRoomSummary[];
  currentUserId: string;
  onStartDm: () => void;
};

function roomDisplayName(r: ChatRoomSummary, currentUserId: string) {
  if (r.name) return r.name;
  const others = r.members.filter((m) => m.id !== currentUserId);
  if (others.length === 1) return others[0].name ?? others[0].username ?? "DM";
  return others.map((o) => o.name ?? o.username ?? "?").join(", ");
}

export function RoomListSidebar({ rooms, currentUserId, onStartDm }: Props) {
  return (
    <aside className="flex w-64 flex-col border-r">
      <div className="flex items-center justify-between p-2">
        <h2 className="text-sm font-medium">Conversations</h2>
        <button type="button" onClick={onStartDm} className="text-sm underline">
          New DM
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {rooms.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No conversations yet
          </p>
        )}
        {rooms.map((r) => (
          <Link
            key={r.id}
            to={"/chat/$roomId" as string}
            params={{ roomId: r.id } as never}
            className="block border-b p-2 hover:bg-muted"
            activeProps={{ className: "bg-muted" }}
          >
            <div className="text-sm font-medium">
              {roomDisplayName(r, currentUserId)}
            </div>
            {r.unreadCount > 0 && (
              <div className="text-xs text-primary">{r.unreadCount} new</div>
            )}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
