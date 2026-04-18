import {
  TYPING_DEBOUNCE_MS,
  TYPING_IDLE_STOP_MS,
} from "@project/api/domains/chat/constants";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../upload-file";

type Props = {
  roomId: string;
  onSendText: (text: string) => Promise<unknown>;
  onSendFile: (fileId: string) => Promise<unknown>;
  onTypingStart: () => void;
  onTypingStop: () => void;
};

export function MessageComposer({
  roomId: _roomId,
  onSendText,
  onSendFile,
  onTypingStart,
  onTypingStop,
}: Props) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastStartRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    },
    [],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastStartRef.current > TYPING_DEBOUNCE_MS) {
      lastStartRef.current = now;
      onTypingStart();
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      onTypingStop();
      lastStartRef.current = 0;
    }, TYPING_IDLE_STOP_MS);
  };

  const handleSend = async () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    onTypingStop();
    await onSendText(v);
  };

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { fileId } = await uploadFile(file);
      await onSendFile(fileId);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
      className="flex items-center gap-2 border-t p-2"
    >
      <Input
        aria-label="Message"
        value={text}
        onChange={handleChange}
        placeholder="Type a message…"
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleAttach}
        aria-label="Attach file"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "Attach"}
      </Button>
      <Button type="submit" disabled={!text.trim()}>
        Send
      </Button>
    </form>
  );
}
