import type { AppRouter } from "@project/api/router";
import { Input } from "@project/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { useDebouncedValue } from "#/features/user/use-debounced-value";

type Candidate = { id: string; username: string; name: string };

export function InviteAutocomplete({
  trpc,
  onSelect,
  disabled,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
  onSelect: (selection: Candidate | null) => void;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState("");
  const debounced = useDebouncedValue(raw, 200);
  const enabled = debounced.trim().length > 0;

  const results = useQuery({
    ...trpc.user.searchByUsername.queryOptions(
      { prefix: debounced.trim() },
      { enabled },
    ),
  });

  const matches: Candidate[] = enabled ? (results.data ?? []) : [];
  const showNoMatch = enabled && results.isSuccess && matches.length === 0;

  return (
    <div className="space-y-1 w-full">
      <Input
        placeholder="Search by username or name"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onSelect(null);
        }}
        disabled={disabled}
        autoFocus
      />
      {matches.length > 0 && (
        <ul className="border rounded divide-y">
          {matches.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-muted"
                onClick={() => {
                  onSelect(u);
                  setRaw(`@${u.username}`);
                }}
              >
                <span className="font-medium">{u.name}</span>{" "}
                <span className="text-muted-foreground">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showNoMatch && (
        <p className="text-sm text-destructive">No user with that username.</p>
      )}
    </div>
  );
}
