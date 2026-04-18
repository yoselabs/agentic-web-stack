import type { ChatMessage } from "../types";
import { fileDownloadUrl } from "../upload-file";

type Props = {
  messages: ChatMessage[];
  typingUserIds: string[];
};

export function MessageList({ messages, typingUserIds }: Props) {
  const ordered = [...messages].reverse(); // server sends newest-first; UI shows oldest-first
  return (
    <div
      className="flex flex-col gap-2 overflow-y-auto p-4"
      aria-label="Messages"
    >
      {ordered.map((m) => (
        <div
          key={m.id}
          className="rounded-md border p-2"
          data-userid={m.userId}
        >
          <div className="text-xs text-muted-foreground">{m.userId}</div>
          {m.kind === "TEXT" ? (
            <div>{m.text}</div>
          ) : m.fileId ? (
            <a
              className="text-sm underline"
              href={fileDownloadUrl(m.fileId)}
              target="_blank"
              rel="noreferrer"
            >
              Download file
            </a>
          ) : null}
        </div>
      ))}
      {typingUserIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {typingUserIds.length === 1
            ? "1 person is typing…"
            : `${typingUserIds.length} people are typing…`}
        </div>
      )}
    </div>
  );
}
