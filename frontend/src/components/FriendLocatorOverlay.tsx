"use client";

import { useEffect, useState, useCallback } from "react";

export type ScanState = "idle" | "scanning" | "found";

interface Props {
  state: ScanState;
  friends: string[];
}

// ── Per-friend card that simulates a GPS fetch lifecycle ──
type CardPhase = "connecting" | "gps" | "locking" | "locked" | "found";

function SignalBars({ phase }: { phase: CardPhase }) {
  const active = phase === "connecting" ? 1 : phase === "gps" ? 2 : 3;
  return (
    <div className="flex items-end gap-[2px] h-3 mr-1">
      {[1, 2, 3].map((bar) => (
        <div
          key={bar}
          className="rounded-sm transition-all duration-300"
          style={{
            width: "3px",
            height: `${bar * 33}%`,
            backgroundColor:
              bar <= active
                ? phase === "found" || phase === "locked"
                  ? "#34D399"
                  : "#5EEAD4"
                : "rgba(255,255,255,0.15)",
            animation:
              bar <= active && phase !== "locked" && phase !== "found"
                ? `signal-fill 1.2s ease-in-out ${bar * 0.15}s infinite`
                : "none",
          }}
        />
      ))}
    </div>
  );
}

function useScrambleCoords(active: boolean) {
  const [text, setText] = useState("");

  const scramble = useCallback(() => {
    const lat = (37 + Math.random() * 0.8).toFixed(4);
    const lng = (-122 - Math.random() * 0.5).toFixed(4);
    return `${lat}°N ${lng}°W`;
  }, []);

  useEffect(() => {
    if (!active) return;
    setText(scramble());
    const interval = setInterval(() => setText(scramble()), 80);
    return () => clearInterval(interval);
  }, [active, scramble]);

  return text;
}

function FriendScanCard({
  name,
  index,
  scanState,
}: {
  name: string;
  index: number;
  scanState: ScanState;
}) {
  const [phase, setPhase] = useState<CardPhase>("connecting");

  useEffect(() => {
    if (scanState === "found") {
      setPhase("found");
      return;
    }
    if (scanState !== "scanning") {
      setPhase("connecting");
      return;
    }
    // scanning → progress through phases with random-ish timing
    setPhase("connecting");
    const t1 = setTimeout(() => setPhase("gps"), 600 + index * 200);
    const t2 = setTimeout(() => setPhase("locking"), 1400 + index * 300);
    const t3 = setTimeout(() => setPhase("locked"), 2200 + index * 250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [scanState, index]);

  const scrambling = phase === "gps" || phase === "locking";
  const coords = useScrambleCoords(scrambling);

  const statusLine = (() => {
    switch (phase) {
      case "connecting":
        return (
          <span className="text-cyan-300/70">
            Pinging device
            <span style={{ animation: "blink-cursor 1s step-end infinite" }}>...</span>
          </span>
        );
      case "gps":
        return (
          <span className="text-teal-300 font-mono text-[10px] tabular-nums tracking-tight">
            {coords}
          </span>
        );
      case "locking":
        return (
          <span className="text-amber-300 font-mono text-[10px] tabular-nums tracking-tight">
            {coords}
          </span>
        );
      case "locked":
        return <span className="text-emerald-300 text-[11px]">Signal locked</span>;
      case "found":
        return <span className="text-emerald-400 text-[11px] font-semibold">Located</span>;
    }
  })();

  return (
    <div
      className="flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-lg"
      style={{
        backgroundColor:
          phase === "found"
            ? "rgba(16, 185, 129, 0.15)"
            : "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(8px)",
        border:
          phase === "found"
            ? "1px solid rgba(16, 185, 129, 0.3)"
            : phase === "locked"
            ? "1px solid rgba(20, 184, 166, 0.2)"
            : "1px solid rgba(255,255,255,0.06)",
        animation: `fadeSlideIn 0.35s ease-out both`,
        transition: "background-color 0.4s, border-color 0.4s",
      }}
    >
      {/* Signal bars */}
      <SignalBars phase={phase} />

      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{
          background:
            phase === "found"
              ? "linear-gradient(135deg, #10B981, #059669)"
              : "linear-gradient(135deg, #14B8A6, #2563EB)",
          transition: "background 0.5s",
          boxShadow:
            phase === "locked" || phase === "found"
              ? "0 0 8px rgba(16,185,129,0.4)"
              : "none",
        }}
      >
        {name[0]}
      </div>

      {/* Name + status */}
      <div className="flex flex-col min-w-0">
        <span className="text-white text-[12px] font-medium leading-tight">{name}</span>
        <span className="leading-tight mt-0.5">{statusLine}</span>
      </div>

      {/* Check icon when found */}
      {(phase === "locked" || phase === "found") && (
        <svg
          className="w-4 h-4 ml-auto shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke={phase === "found" ? "#34D399" : "#5EEAD4"}
          strokeWidth={2.5}
          style={{ animation: "pin-drop 0.4s ease-out both" }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  );
}

// ── Main overlay ──
export default function FriendLocatorOverlay({ state, friends }: Props) {
  const [fadingOut, setFadingOut] = useState(false);
  const [visible, setVisible] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (state === "scanning") {
      setFadingOut(false);
      setVisible(true);
      setVisibleCount(0);
    } else if (state === "found") {
      setVisibleCount(friends.length);
      const timer = setTimeout(() => setFadingOut(true), 1400);
      const hideTimer = setTimeout(() => setVisible(false), 2400);
      return () => {
        clearTimeout(timer);
        clearTimeout(hideTimer);
      };
    } else {
      setVisible(false);
      setFadingOut(false);
      setVisibleCount(0);
    }
  }, [state, friends.length]);

  // Stagger card appearance
  useEffect(() => {
    if (state !== "scanning" || friends.length === 0) return;
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setVisibleCount(count);
      if (count >= friends.length) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [state, friends.length]);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-10 pointer-events-none overflow-hidden"
      style={{
        opacity: fadingOut ? 0 : 1,
        transition: "opacity 1s ease-out",
      }}
    >
      {/* Dark overlay */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(15, 23, 42, 0.5)" }}
      />

      {/* Green flash on found */}
      {state === "found" && !fadingOut && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle, rgba(16,185,129,0.35) 0%, transparent 70%)",
            animation: "fadeSlideIn 0.5s ease-out",
          }}
        />
      )}

      {/* Concentric rings + crosshair */}
      <div className="absolute inset-0 flex items-center justify-center">
        {[1, 2, 3].map((ring) => (
          <div
            key={ring}
            className="absolute rounded-full border"
            style={{
              width: `${ring * 120}px`,
              height: `${ring * 120}px`,
              borderColor:
                state === "found"
                  ? "rgba(16, 185, 129, 0.3)"
                  : "rgba(20, 184, 166, 0.2)",
              transition: "border-color 0.5s",
            }}
          />
        ))}
        <div
          className="absolute"
          style={{
            width: "360px",
            height: "1px",
            backgroundColor:
              state === "found"
                ? "rgba(16,185,129,0.15)"
                : "rgba(20,184,166,0.1)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: "1px",
            height: "360px",
            backgroundColor:
              state === "found"
                ? "rgba(16,185,129,0.15)"
                : "rgba(20,184,166,0.1)",
          }}
        />

        {/* Radar sweep */}
        {state === "scanning" && (
          <div
            className="absolute"
            style={{
              width: "360px",
              height: "360px",
              borderRadius: "50%",
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(20,184,166,0.4) 40deg, transparent 80deg)",
              animation: "radar-sweep 2s linear infinite",
            }}
          />
        )}

        {/* Center dot */}
        <div
          className="absolute rounded-full"
          style={{
            width: "8px",
            height: "8px",
            backgroundColor: state === "found" ? "#10B981" : "#14B8A6",
            boxShadow:
              state === "found"
                ? "0 0 12px rgba(16,185,129,0.6)"
                : "0 0 8px rgba(20,184,166,0.4)",
          }}
        />
        {state === "found" && (
          <div
            className="absolute rounded-full"
            style={{
              width: "8px",
              height: "8px",
              border: "2px solid rgba(16,185,129,0.5)",
              animation: "pulse-ring 1s ease-out",
            }}
          />
        )}
      </div>

      {/* Friend scan cards (top-right) */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 w-56">
        {friends.slice(0, visibleCount).map((name, i) => (
          <FriendScanCard
            key={name}
            name={name}
            index={i}
            scanState={state}
          />
        ))}
      </div>

      {/* Status pill (bottom center) */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center">
        <div
          className="px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-2"
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(8px)",
            border:
              state === "found"
                ? "1px solid rgba(16,185,129,0.3)"
                : "1px solid rgba(255,255,255,0.08)",
            color: state === "found" ? "#34D399" : "#99F6E4",
            animation:
              state === "scanning"
                ? "scan-text 1.5s ease-in-out infinite"
                : "none",
            transition: "border-color 0.4s, color 0.4s",
          }}
        >
          {state === "found" ? (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {friends.length} friend{friends.length !== 1 ? "s" : ""} located
            </>
          ) : (
            <>
              <span
                className="w-4 h-4 border-2 border-teal-400 border-t-transparent rounded-full"
                style={{ animation: "radar-sweep 0.8s linear infinite" }}
              />
              Fetching locations...
            </>
          )}
        </div>
      </div>
    </div>
  );
}
