import { useState, useRef, useCallback } from "react";
import { sendTypingEvent, sendDmTypingEvent } from "../platform/commands/messages";

interface TypingEntry { name: string; ts: number }

export function useTypingIndicators(
  getSelectedChannelId: () => string | undefined,
  getSelectedConversationId: () => string | undefined,
) {
  const [typingByKey, setTypingByKey] = useState<Record<string, TypingEntry>>({});
  const [dmTypingByKey, setDmTypingByKey] = useState<Record<string, TypingEntry>>({});

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dmTypingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function receiveTyping(raw: Record<string, unknown>) {
    const type = raw.type as string;
    const sender = raw.sender as string | undefined;
    const name = (raw.sender_name as string | undefined) ?? (sender ? sender.slice(0, 8) : "Someone");
    const now = Date.now();

    if (type === "typing" || type === "typing_start") {
      const channelId = raw.channel_id as string | undefined;
      if (!channelId) return;
      const key = `${channelId}:${sender ?? ""}`;
      setTypingByKey((prev) => ({ ...prev, [key]: { name, ts: now } }));
      setTimeout(() => {
        setTypingByKey((prev) => {
          const entry = prev[key];
          if (!entry || entry.ts !== now) return prev;
          const { [key]: _, ...rest } = prev;
          return rest;
        });
      }, 6000);
    } else if (type === "typing_stop") {
      const channelId = raw.channel_id as string | undefined;
      if (!channelId || !sender) return;
      const key = `${channelId}:${sender}`;
      setTypingByKey((prev) => { const { [key]: _, ...rest } = prev; return rest; });
    } else if (type === "dm_typing") {
      const convId = raw.conversation_id as string | undefined;
      if (!convId) return;
      const key = `${convId}:${sender ?? ""}`;
      setDmTypingByKey((prev) => ({ ...prev, [key]: { name, ts: now } }));
      setTimeout(() => {
        setDmTypingByKey((prev) => {
          const entry = prev[key];
          if (!entry || entry.ts !== now) return prev;
          const { [key]: _, ...rest } = prev;
          return rest;
        });
      }, 6000);
    }
  }

  const pingTyping = useCallback(() => {
    const chId = getSelectedChannelId();
    if (!chId) return;
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    } else {
      try { sendTypingEvent(chId); } catch {}
    }
    typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null; }, 3000);
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      typingStopTimerRef.current = null;
      typingTimerRef.current = null;
    }, 5000);
  }, [getSelectedChannelId]);

  const pingDmTyping = useCallback(() => {
    const convId = getSelectedConversationId();
    if (!convId) return;
    if (dmTypingTimerRef.current) {
      clearTimeout(dmTypingTimerRef.current);
      dmTypingTimerRef.current = null;
    } else {
      try { sendDmTypingEvent(convId); } catch {}
    }
    dmTypingTimerRef.current = setTimeout(() => { dmTypingTimerRef.current = null; }, 3000);
    if (dmTypingStopTimerRef.current) clearTimeout(dmTypingStopTimerRef.current);
    dmTypingStopTimerRef.current = setTimeout(() => {
      dmTypingStopTimerRef.current = null;
      dmTypingTimerRef.current = null;
    }, 5000);
  }, [getSelectedConversationId]);

  return {
    typingByKey,
    dmTypingByKey,
    receiveTyping,
    pingTyping,
    pingDmTyping,
  };
}
