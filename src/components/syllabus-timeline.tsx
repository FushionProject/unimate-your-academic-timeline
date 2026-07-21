import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, X } from "lucide-react";

type ItemType = "exam" | "quiz" | "assignment" | "deadline";
export interface TimelineItem {
  title: string;
  type: ItemType;
  due_date: string;
}

// Cream/yellow palette per design spec, plus per-type marker colors.
const CREAM = "#FAF7F2";
const YELLOW = "#F5C518";
const INK = "#2a2622";
const MUTED = "#8a8178";

const TYPE_COLOR: Record<ItemType, string> = {
  quiz: "#3b82f6", // blue
  exam: "#ef4444", // red
  assignment: "#f97316", // orange
  deadline: "#64748b", // slate (not in the spec's 3, kept distinct)
};

const DAY_MS = 86400000;
const parseDue = (d: string) => new Date(d + "T12:00:00");
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

const MIN_PX_PER_DAY = 3;
const MAX_PX_PER_DAY = 44;
const MARKER_SLOT = 150; // horizontal room a marker+label needs, in px, for lane packing

export function SyllabusTimeline({ items }: { items: TimelineItem[] }) {
  const [pxPerDay, setPxPerDay] = useState(12);
  const [selected, setSelected] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [todayTime, setTodayTime] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Confine all `new Date()` usage to the client so SSR/hydration can't
  // disagree about "today". The axis itself is derived purely from props.
  useEffect(() => {
    setMounted(true);
    setTodayTime(Date.now());
  }, []);

  const model = useMemo(() => {
    if (!items || items.length === 0) return null;

    const dates = items.map((i) => parseDue(i.due_date).getTime());
    let minT = Math.min(...dates);
    let maxT = Math.max(...dates);
    // Extend the range to always include today so the "Today" marker is
    // visible even when the current date falls before/after the coursework.
    // todayTime is null during SSR + first client render (keeps hydration in
    // sync); it's filled in after mount, which harmlessly re-lays-out.
    if (todayTime !== null) {
      minT = Math.min(minT, todayTime);
      maxT = Math.max(maxT, todayTime);
    }
    const start = startOfMonth(new Date(minT));
    const end = endOfMonth(new Date(maxT));
    const startTime = start.getTime();
    const totalDays = Math.max(1, Math.round((end.getTime() - startTime) / DAY_MS) + 1);

    // Month ticks across the range.
    const months: Date[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Lane packing: markers close together get stacked into separate rows so
    // they never overlap. Process left-to-right; reuse the lowest free lane.
    const ordered = items
      .map((it, idx) => ({ it, idx, time: parseDue(it.due_date).getTime() }))
      .sort((a, b) => a.time - b.time);
    const laneLastX: number[] = [];
    const laneByIdx: Record<number, number> = {};
    for (const { idx, time } of ordered) {
      const x = (time - startTime) / DAY_MS;
      let lane = 0;
      while (lane < laneLastX.length && x - laneLastX[lane] < MARKER_SLOT / Math.max(pxPerDay, 1))
        lane++;
      laneLastX[lane] = x;
      laneByIdx[idx] = lane;
    }

    return {
      startTime,
      totalDays,
      months,
      laneByIdx,
      laneCount: Math.max(1, laneLastX.length),
    };
  }, [items, pxPerDay, todayTime]);

  const width = model ? model.totalDays * pxPerDay : 0;
  const xForTime = (t: number) => (model ? ((t - model.startTime) / DAY_MS) * pxPerDay : 0);

  const laneCount = model?.laneCount ?? 1;
  const AXIS_Y = 40; // distance from top to the month axis line
  const LANE_H = 34;
  const trackHeight = AXIS_Y + laneCount * LANE_H + 24;

  // On first paint, scroll so today (or the first item) sits ~1/4 in.
  useEffect(() => {
    if (!mounted || !model || !scrollRef.current) return;
    const anchorTime = todayTime && todayTime >= model.startTime ? todayTime : model.startTime;
    const target = xForTime(anchorTime) - scrollRef.current.clientWidth / 4;
    scrollRef.current.scrollLeft = Math.max(0, target);
    // Only re-anchor when the data or zoom changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, model, pxPerDay]);

  if (!items || items.length === 0) {
    return (
      <div className="rounded-2xl p-10 text-center" style={{ background: CREAM, color: MUTED }}>
        No items found. Please try again.
      </div>
    );
  }

  const todayX =
    mounted && todayTime !== null && model && todayTime >= model.startTime
      ? xForTime(todayTime)
      : null;
  const todayInRange = todayX !== null && todayX <= width;

  const zoomOut = () => setPxPerDay((p) => Math.max(MIN_PX_PER_DAY, Math.round(p * 0.75)));
  const zoomIn = () => setPxPerDay((p) => Math.min(MAX_PX_PER_DAY, Math.round(p * 1.35) || p + 1));

  const selectedItem = selected !== null ? items[selected] : null;

  const relativeLabel = (time: number) => {
    if (todayTime === null) return "";
    const diffDays = Math.round((time - todayTime) / DAY_MS);
    if (diffDays === 0) return "Due today";
    if (diffDays > 0) return `In ${diffDays} day${diffDays === 1 ? "" : "s"}`;
    return `${Math.abs(diffDays)} day${diffDays === -1 ? "" : "s"} ago`;
  };

  return (
    <div
      className="rounded-2xl overflow-hidden mb-8"
      style={{ background: CREAM, border: "1px solid rgba(0,0,0,0.06)" }}
    >
      {/* Controls + legend */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div className="flex items-center gap-4 text-xs flex-wrap" style={{ color: INK }}>
          {(["quiz", "exam", "assignment"] as ItemType[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 capitalize">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: TYPE_COLOR[t] }}
              />
              {t}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={zoomOut}
            aria-label="Zoom out"
            disabled={pxPerDay <= MIN_PX_PER_DAY}
            className="grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40"
            style={{ background: YELLOW, color: INK }}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={zoomIn}
            aria-label="Zoom in"
            disabled={pxPerDay >= MAX_PX_PER_DAY}
            className="grid h-8 w-8 place-items-center rounded-lg disabled:opacity-40"
            style={{ background: YELLOW, color: INK }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden"
        style={{ background: CREAM }}
      >
        <div
          style={{
            position: "relative",
            width: `${width}px`,
            height: `${trackHeight}px`,
            minWidth: "100%",
          }}
        >
          {/* Axis line */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${AXIS_Y}px`,
              height: "2px",
              background: "rgba(0,0,0,0.12)",
            }}
          />

          {/* Month ticks + labels */}
          {model?.months.map((m, i) => {
            const x = xForTime(m.getTime());
            const label =
              m.getMonth() === 0 || i === 0
                ? m.toLocaleDateString("en-US", { month: "short", year: "numeric" })
                : m.toLocaleDateString("en-US", { month: "short" });
            return (
              <div key={i} style={{ position: "absolute", left: `${x}px`, top: 0 }}>
                <div
                  style={{
                    position: "absolute",
                    top: `${AXIS_Y - 6}px`,
                    width: "1px",
                    height: "12px",
                    background: "rgba(0,0,0,0.18)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: `${AXIS_Y + 10}px`,
                    transform: "translateX(-2px)",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: MUTED,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </div>
              </div>
            );
          })}

          {/* Today marker */}
          {todayInRange && (
            <div style={{ position: "absolute", left: `${todayX}px`, top: 0, bottom: 0 }}>
              <div
                style={{
                  position: "absolute",
                  top: "6px",
                  bottom: 0,
                  width: "2px",
                  background: YELLOW,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  transform: "translateX(-50%)",
                  background: YELLOW,
                  color: INK,
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: "999px",
                  whiteSpace: "nowrap",
                }}
              >
                Today
              </div>
            </div>
          )}

          {/* Markers */}
          {items.map((item, idx) => {
            const time = parseDue(item.due_date).getTime();
            const x = xForTime(time);
            const lane = model?.laneByIdx[idx] ?? 0;
            const dotY = AXIS_Y - 10 - lane * LANE_H;
            const isSel = selected === idx;
            const color = TYPE_COLOR[item.type];
            return (
              <div key={idx} style={{ position: "absolute", left: `${x}px`, top: 0 }}>
                {/* Stem from dot down to axis */}
                <div
                  style={{
                    position: "absolute",
                    top: `${dotY}px`,
                    height: `${AXIS_Y - dotY}px`,
                    width: "1px",
                    background: "rgba(0,0,0,0.15)",
                  }}
                />
                {/* Label */}
                <button
                  onClick={() => setSelected(isSel ? null : idx)}
                  title={`${item.title} — ${item.type}`}
                  style={{
                    position: "absolute",
                    top: `${dotY - 9}px`,
                    left: "10px",
                    maxWidth: "130px",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: INK,
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    textAlign: "left",
                  }}
                >
                  {item.title}
                </button>
                {/* Dot */}
                <button
                  onClick={() => setSelected(isSel ? null : idx)}
                  aria-label={`${item.title}, ${item.type}, due ${item.due_date}`}
                  style={{
                    position: "absolute",
                    top: `${dotY}px`,
                    left: 0,
                    transform: "translate(-50%, -50%)",
                    height: isSel ? "16px" : "12px",
                    width: isSel ? "16px" : "12px",
                    borderRadius: "999px",
                    background: color,
                    border: isSel ? `3px solid ${YELLOW}` : "2px solid #fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selectedItem && (
        <div
          className="flex items-start justify-between gap-3 px-4 py-3"
          style={{ borderTop: "1px solid rgba(0,0,0,0.06)", background: "#fff" }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: TYPE_COLOR[selectedItem.type] }}
              />
              <h4 className="text-sm font-semibold" style={{ color: INK }}>
                {selectedItem.title}
              </h4>
            </div>
            <p className="text-xs capitalize" style={{ color: MUTED }}>
              {selectedItem.type} ·{" "}
              {parseDue(selectedItem.due_date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              {mounted && ` · ${relativeLabel(parseDue(selectedItem.due_date).getTime())}`}
            </p>
          </div>
          <button
            onClick={() => setSelected(null)}
            aria-label="Close details"
            style={{ color: MUTED }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
