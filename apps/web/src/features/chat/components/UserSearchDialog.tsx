import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect, useState } from "react";
import type { UserSearchResult } from "../types";

type Props = {
  trpc: TRPCOptionsProxy<AppRouter>;
  open: boolean;
  onClose: () => void;
  onPick: (user: UserSearchResult) => void;
};

export function UserSearchDialog({ trpc, open, onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    ...trpc.user.search.queryOptions({ query: debounced }),
    enabled: open && debounced.length >= 2,
  });

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-wrapper pattern needs conditional rendering; <dialog> element requires imperative showModal()/close() API that doesn't fit the open prop flow.
    <div
      role="dialog"
      aria-label="Find user"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-8"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="w-full max-w-md rounded-md border bg-background p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          placeholder="Search by username or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search users"
        />
        <ul className="mt-3 max-h-72 overflow-y-auto">
          {searchQuery.data?.map((u) => (
            <li key={u.userId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded p-2 text-left hover:bg-muted"
                onClick={() => onPick(u)}
              >
                <span className="text-sm font-medium">{u.name}</span>
                <span className="text-xs text-muted-foreground">
                  @{u.username ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
