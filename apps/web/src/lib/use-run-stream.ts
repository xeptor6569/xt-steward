"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiBaseUrl } from "./api";
import type { RunEventDto } from "./types";

export type StreamState = "connecting" | "live" | "reconnecting" | "ended" | "error";

/**
 * Live run event stream over Server-Sent Events.
 *
 * The browser's native EventSource reconnects automatically and re-sends the
 * Last-Event-ID header (we set the event id to the server-assigned sequence),
 * so no events are lost across reconnects. Events are de-duplicated by
 * sequence. When the server signals `stream.end` the stream is closed for
 * good and the run queries are refreshed.
 */
export function useRunStream(runId: string, enabled: boolean) {
  const [events, setEvents] = useState<RunEventDto[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("connecting");
  const lastSequenceRef = useRef(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let closed = false;

    // An empty base means "same origin" (production behind the reverse proxy).
    const url = new URL(
      `/api/v1/runs/${runId}/events/stream`,
      apiBaseUrl() || window.location.origin,
    );
    if (lastSequenceRef.current > 0) {
      url.searchParams.set("lastEventId", String(lastSequenceRef.current));
    }
    const source = new EventSource(url, { withCredentials: true });

    const appendEvent = (raw: MessageEvent<string>) => {
      const event = JSON.parse(raw.data) as RunEventDto;
      if (event.sequence <= lastSequenceRef.current) return;
      lastSequenceRef.current = event.sequence;
      setEvents((prev) => (prev.length >= 5000 ? [...prev.slice(1), event] : [...prev, event]));
      if (event.type === "state") {
        // Keep run status chips in sync with the timeline.
        void queryClient.invalidateQueries({ queryKey: ["runs", runId] });
        void queryClient.invalidateQueries({ queryKey: ["runs"], exact: true });
      }
    };

    source.onopen = () => {
      if (!closed) setStreamState("live");
    };
    source.addEventListener("log", appendEvent);
    source.addEventListener("notice", appendEvent);
    source.addEventListener("state", appendEvent);
    source.addEventListener("stream.end", () => {
      closed = true;
      setStreamState("ended");
      source.close();
      void queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    });
    source.onerror = () => {
      if (closed) return;
      // EventSource retries automatically with Last-Event-ID.
      setStreamState("reconnecting");
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [runId, enabled, queryClient]);

  return { events, streamState };
}
