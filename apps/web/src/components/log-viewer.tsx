"use client";

import { Badge, cn } from "@steward/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRunEventsSnapshot } from "@/lib/queries";
import type { RunEventDto } from "@/lib/types";
import { useRunStream, type StreamState } from "@/lib/use-run-stream";

const STREAM_LABELS: Record<StreamState, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  ended: "Stream ended",
  error: "Stream error",
};

/**
 * Live log timeline for a run. Historical events come from the REST snapshot;
 * live events stream over SSE with automatic resume. The two sources are
 * merged and de-duplicated by server sequence.
 */
export function LogViewer({ runId, isTerminal }: { runId: string; isTerminal: boolean }) {
  const snapshot = useRunEventsSnapshot(runId);
  const { events: liveEvents, streamState } = useRunStream(runId, true);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => {
    const bySequence = new Map<number, RunEventDto>();
    for (const event of snapshot.data?.events ?? []) bySequence.set(event.sequence, event);
    for (const event of liveEvents) bySequence.set(event.sequence, event);
    return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
  }, [snapshot.data, liveEvents]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Run timeline</span>
          <Badge
            variant={
              streamState === "live"
                ? "success"
                : streamState === "ended" || isTerminal
                  ? "outline"
                  : "warning"
            }
          >
            <span aria-live="polite">
              {isTerminal && streamState !== "live" ? "Complete" : STREAM_LABELS[streamState]}
            </span>
          </Badge>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Auto-scroll
        </label>
      </div>
      <div
        ref={scrollRef}
        data-testid="log-viewer"
        className="h-[420px] overflow-y-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100"
        role="log"
        aria-label="Run log output"
      >
        {events.length === 0 ? (
          <p className="text-zinc-500">Waiting for output…</p>
        ) : (
          events.map((event) => <LogLine key={event.sequence} event={event} />)
        )}
      </div>
    </div>
  );
}

function LogLine({ event }: { event: RunEventDto }) {
  const time = new Date(event.createdAt).toLocaleTimeString(undefined, { hour12: false });
  return (
    <div className="flex gap-3 whitespace-pre-wrap break-all">
      <span className="shrink-0 select-none text-zinc-600">{time}</span>
      <span
        className={cn(
          "shrink-0 select-none uppercase",
          event.type === "state" && "text-sky-400",
          event.type === "notice" && "text-amber-400",
          event.stream === "stderr" && "text-red-400",
          event.type === "log" && event.stream !== "stderr" && "text-zinc-500",
        )}
      >
        {event.type === "log" ? (event.stream ?? "log") : event.type}
      </span>
      <span className={cn(event.type === "state" && "font-semibold text-sky-300")}>
        {event.message}
      </span>
    </div>
  );
}
