"use client";

import { useEffect, useRef } from "react";
import { getBrowserClient } from "@/lib/supabase/client";

export type BoardEvent = { board_id?: string; scope?: "content" | "structure" };

/**
 * board_events 신호 구독. 내용은 오지 않으며, 신호를 받으면 호출자가 다시 조회한다.
 * 30명이 동시에 쓸 때 재조회 폭주를 막으려고 300ms 디바운스한다.
 */
export function useProjectEvents(projectId: string, onEvents: (events: BoardEvent[]) => void) {
  const cb = useRef(onEvents);
  useEffect(() => {
    cb.current = onEvents;
  });
  useEffect(() => {
    const supabase = getBrowserClient();
    let pending: BoardEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      const evs = pending;
      pending = [];
      timer = null;
      cb.current(evs);
    };
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`project:${projectId}:${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "board_events", filter: `project_id=eq.${projectId}` },
          (payload) => {
            const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as BoardEvent;
            pending.push({
              board_id: row?.board_id,
              scope: payload.eventType === "DELETE" ? "structure" : row?.scope,
            });
            if (!timer) timer = setTimeout(flush, 300);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            (window as unknown as { __rtReady?: Record<string, boolean> }).__rtReady ??= {};
            (window as unknown as { __rtReady: Record<string, boolean> }).__rtReady[projectId] = true;
          }
        });
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [projectId]);
}
