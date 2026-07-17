"use client";

// Live incident state, keyed strictly by Incident.id.
//
// Correctness rules this store enforces:
//  - An id seen twice (initial GET then SSE, SSE then poll, correction then its
//    SSE echo) is ALWAYS an in-place merge, never a second entry. `entries` is a
//    Record keyed by id, so double-keying is structurally impossible; `order` is
//    rebuilt from entries, so it can't hold a stale or duplicate id either.
//  - SSE bursts are absorbed by a buffer that flushes at most once per FLUSH_MS,
//    so N events cost one setState (one notify), not N re-renders of the feed.
import { create } from "zustand";
import type { Incident } from "@/types/incident";
import type { StreamState } from "@/lib/sse/createIncidentStream";

/** One transient "duplicate pulled under" chip in the sink zone. */
export interface SinkItem {
  /** Unique per chip — the same incident id could sink twice across a session. */
  key: string;
  incident: Incident;
}

interface IncidentStoreState {
  entries: Record<string, Incident>;
  /** All ids, createdAt-desc. Feed selectors filter this; it is never appended to directly. */
  order: string[];
  /** Ids that arrived via the live stream after mount — these get the rise entrance. */
  arrivals: Record<string, true>;
  /** Duplicates currently animating in the sink zone. */
  sinking: SinkItem[];
  /** Duplicates observed live this session ("pulled under" counter). */
  suppressedCount: number;
  streamState: StreamState;
  /** True once the initial GET (or a substitute snapshot) has populated the store. */
  hydrated: boolean;
  loadError: string | null;

  loadInitial: (incidents: Incident[]) => void;
  ingestSnapshot: (incidents: Incident[]) => void;
  applyBatch: (batch: Incident[], live: boolean) => void;
  applyCorrection: (subset: Partial<Incident> & { id: string }) => void;
  retireSink: (key: string) => void;
  setStreamState: (state: StreamState) => void;
  setLoadError: (message: string | null) => void;
}

const byCreatedAtDesc = (a: Incident, b: Incident) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/**
 * Hard ceiling on concurrent sink chips. In a hidden tab rAF is suspended, so
 * chip animations can't complete and a duplicate storm would otherwise pile up
 * frozen chips without bound; the oldest are dropped silently (their count
 * already lives in suppressedCount, which is the durable record).
 */
const SINK_QUEUE_MAX = 8;

let sinkKeyCounter = 0;

export const useIncidentStore = create<IncidentStoreState>((set, get) => ({
  entries: {},
  order: [],
  arrivals: {},
  sinking: [],
  suppressedCount: 0,
  streamState: "connecting",
  hydrated: false,
  loadError: null,

  loadInitial: (incidents) => {
    get().applyBatch(incidents, false);
    set({ hydrated: true, loadError: null });
  },

  ingestSnapshot: (incidents) => {
    // A snapshot that arrives before any initial load IS the initial load —
    // animating a whole first page "arriving" would be a wall of motion and a lie.
    const live = get().hydrated;
    get().applyBatch(incidents, live);
    if (!live) set({ hydrated: true, loadError: null });
  },

  applyBatch: (batch, live) =>
    set((state) => {
      const entries = { ...state.entries };
      const arrivals = { ...state.arrivals };
      const newChips: SinkItem[] = [];
      let suppressed = state.suppressedCount;

      for (const incoming of batch) {
        const prev = entries[incoming.id];
        // In-place merge by id — the whole anti-duplication guarantee.
        entries[incoming.id] = prev ? { ...prev, ...incoming } : incoming;

        if (!live) continue;

        if (incoming.status === "DUPLICATE") {
          if (!prev) {
            // Dedupe caught it at the door: it never joins the feed. It gets a
            // transient sink chip under the waterline instead.
            newChips.push({ key: `${incoming.id}:${sinkKeyCounter++}`, incident: incoming });
            suppressed += 1;
          } else if (prev.status !== "DUPLICATE") {
            // Was in the feed, now marked duplicate: the card itself sinks out
            // via the feed's exit animation. No chip — one sink per incident.
            suppressed += 1;
          }
        } else if (!prev) {
          arrivals[incoming.id] = true;
        }
      }

      return {
        entries,
        order: Object.values(entries).sort(byCreatedAtDesc).map((i) => i.id),
        arrivals,
        suppressedCount: suppressed,
        sinking: newChips.length
          ? [...state.sinking, ...newChips].slice(-SINK_QUEUE_MAX)
          : state.sinking,
      };
    }),

  applyCorrection: (subset) =>
    set((state) => {
      const prev = state.entries[subset.id];
      if (!prev) return state;
      const next = { ...prev, ...subset };
      const becameDuplicate = prev.status !== "DUPLICATE" && next.status === "DUPLICATE";
      return {
        entries: { ...state.entries, [subset.id]: next },
        // The SSE echo of this correction lands with prev.status already
        // DUPLICATE, so the counter can't double-increment.
        suppressedCount: becameDuplicate ? state.suppressedCount + 1 : state.suppressedCount,
      };
    }),

  retireSink: (key) =>
    set((state) => ({ sinking: state.sinking.filter((chip) => chip.key !== key) })),

  setStreamState: (streamState) => set({ streamState }),
  setLoadError: (loadError) => set({ loadError }),
}));

// --- Buffered live ingest ------------------------------------------------------
// SSE handlers call this instead of applyBatch directly. A worker draining a
// batch can emit dozens of events in tens of milliseconds; the buffer coalesces
// them into a single store update per FLUSH_MS window.

const FLUSH_MS = 80;

let liveBuffer: Incident[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function ingestLiveIncident(incident: Incident): void {
  liveBuffer.push(incident);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = liveBuffer;
    liveBuffer = [];
    useIncidentStore.getState().applyBatch(batch, true);
  }, FLUSH_MS);
}
