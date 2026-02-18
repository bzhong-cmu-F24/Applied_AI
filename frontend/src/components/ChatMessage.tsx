"use client";

import { useEffect, useState, useCallback } from "react";

export type MessageRole = "user" | "assistant" | "status";

export interface ChatMsg {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  statusType?: "thinking" | "tool_call" | "tool_result" | "error";
  toolName?: string;
  friendNames?: string[];
}

const TOOL_LABELS: Record<string, { icon: string; label: string }> = {
  get_friends_info: { icon: "👥", label: "Fetching friend locations" },
  search_restaurants: { icon: "🔍", label: "Retrieving candidate restaurants" },
  calculate_drive_times: { icon: "🚗", label: "Calculating commute times" },
  validate_restaurants: { icon: "✅", label: "Filtering restaurants" },
  rank_and_score: { icon: "📊", label: "Ranking final candidates" },
  get_restaurant_details: { icon: "📋", label: "Fetching restaurant details" },
  get_yelp_info: { icon: "⭐", label: "Fetching Yelp reviews & menu" },
  book_ride: { icon: "🚗", label: "Booking Uber ride" },
  add_to_calendar: { icon: "📅", label: "Creating calendar event" },
};

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Scramble hook for fake GPS coords ──
function useScramble(active: boolean) {
  const [text, setText] = useState("");
  const gen = useCallback(() => {
    const lat = (37 + Math.random() * 0.8).toFixed(4);
    const lng = (-122 - Math.random() * 0.5).toFixed(4);
    return `${lat}°N  ${lng}°W`;
  }, []);
  useEffect(() => {
    if (!active) return;
    setText(gen());
    const id = setInterval(() => setText(gen()), 90);
    return () => clearInterval(id);
  }, [active, gen]);
  return text;
}

// ── Per-friend row inside the chat scan card ──
type Phase = "wait" | "ping" | "gps" | "locked";

function ScanRow({ name, index, isResult }: { name: string; index: number; isResult: boolean }) {
  const [phase, setPhase] = useState<Phase>("wait");

  useEffect(() => {
    if (isResult) { setPhase("locked"); return; }
    setPhase("wait");
    const t0 = setTimeout(() => setPhase("ping"), 100 + index * 600);
    const t1 = setTimeout(() => setPhase("gps"), 700 + index * 600);
    const t2 = setTimeout(() => setPhase("locked"), 1500 + index * 500);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [isResult, index]);

  const coords = useScramble(phase === "gps");

  return (
    <div
      className="flex items-center gap-2 py-1.5"
      style={{ animation: "fadeSlideIn 0.3s ease-out both" }}
    >
      {/* Signal dots */}
      <div className="flex gap-[3px] items-center w-5 shrink-0">
        {[0, 1, 2].map((d) => (
          <div
            key={d}
            className="w-[5px] h-[5px] rounded-full transition-colors duration-300"
            style={{
              backgroundColor:
                phase === "locked"
                  ? "#34D399"
                  : phase === "gps" && d <= 1
                  ? "#5EEAD4"
                  : phase === "ping" && d === 0
                  ? "#5EEAD4"
                  : "rgba(255,255,255,0.15)",
            }}
          />
        ))}
      </div>
      {/* Avatar */}
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-all duration-300"
        style={{
          background:
            phase === "locked"
              ? "linear-gradient(135deg,#10B981,#059669)"
              : "linear-gradient(135deg,#14B8A6,#2563EB)",
          color: "white",
          boxShadow: phase === "locked" ? "0 0 8px rgba(16,185,129,0.5)" : "none",
        }}
      >
        {name[0]}
      </div>
      {/* Name */}
      <span className="text-white text-[12px] font-medium w-16 truncate">{name}</span>
      {/* Status */}
      <span className="ml-auto text-[10px] tabular-nums whitespace-nowrap">
        {phase === "wait" && <span className="text-slate-500">waiting...</span>}
        {phase === "ping" && (
          <span className="text-cyan-400" style={{ animation: "scan-text 1.2s ease-in-out infinite" }}>
            pinging...
          </span>
        )}
        {phase === "gps" && (
          <span className="text-teal-300 font-mono tracking-tight">{coords}</span>
        )}
        {phase === "locked" && (
          <span className="text-emerald-400 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            locked
          </span>
        )}
      </span>
    </div>
  );
}

// ── Chat card for get_friends_info ──
function FriendScanChatCard({ names, isResult }: { names: string[]; isResult: boolean }) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (isResult) { setVisibleCount(names.length); return; }
    setVisibleCount(0);
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setVisibleCount(count);
      if (count >= names.length) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, [isResult, names.length]);

  if (isResult) {
    // ── Found state: compact green card ──
    return (
      <div className="pl-11 animate-fade-in">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 max-w-[340px]">
          <div className="flex items-center gap-2 text-xs text-emerald-700 font-semibold mb-2.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {names.length} friend{names.length !== 1 ? "s" : ""} located
          </div>
          <div className="flex flex-wrap gap-1.5">
            {names.map((name, i) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg text-xs border border-emerald-100"
                style={{ animation: `fadeSlideIn 0.3s ease-out ${i * 0.1}s both` }}
              >
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="text-gray-700 font-medium">{name}</span>
                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Scanning state: dark terminal-style card ──
  return (
    <div className="pl-11 animate-fade-in">
      <div className="bg-slate-900 rounded-xl px-4 py-3 max-w-[340px] border border-slate-700/50">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/50">
          <span
            className="w-2 h-2 bg-teal-400 rounded-full"
            style={{ animation: "pulse-ring 1.5s ease-out infinite" }}
          />
          <span className="text-[11px] text-teal-300 font-medium tracking-wide">
            LOCATING FRIENDS
          </span>
          <span
            className="ml-auto w-3.5 h-3.5 border-2 border-teal-500 border-t-transparent rounded-full"
            style={{ animation: "radar-sweep 0.8s linear infinite" }}
          />
        </div>
        {/* Friend rows */}
        <div>
          {names.slice(0, visibleCount).map((name, i) => (
            <ScanRow key={name} name={name} index={i} isResult={false} />
          ))}
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden mt-3">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-cyan-400 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${names.length > 0 ? (visibleCount / names.length) * 100 : 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ChatMessage({ msg }: { msg: ChatMsg }) {
  // User message
  if (msg.role === "user") {
    return (
      <div className="flex gap-3 justify-end animate-fade-in">
        <div className="max-w-[80%] bg-gradient-to-r from-teal-500 to-blue-600 text-white rounded-2xl rounded-br-md px-4 py-3">
          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          <span className="text-[10px] opacity-70 mt-1 block text-right">{formatTime(msg.timestamp)}</span>
        </div>
        <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
      </div>
    );
  }

  // Status messages (tool calls, thinking)
  if (msg.role === "status") {
    if (msg.statusType === "tool_call") {
      // Special animated card for get_friends_info
      if (msg.toolName === "get_friends_info" && msg.friendNames && msg.friendNames.length > 0) {
        return <FriendScanChatCard names={msg.friendNames} isResult={false} />;
      }
      const info = TOOL_LABELS[msg.toolName || ""] || { icon: "⚡", label: msg.toolName };
      return (
        <div className="flex items-center gap-2 animate-fade-in py-1 pl-11">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-full text-xs font-medium">
            <span>{info.icon}</span>
            <span>{info.label}</span>
            <span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      );
    }
    if (msg.statusType === "tool_result") {
      // Special found card for get_friends_info
      if (msg.toolName === "get_friends_info" && msg.friendNames && msg.friendNames.length > 0) {
        return <FriendScanChatCard names={msg.friendNames} isResult={true} />;
      }
      return (
        <div className="flex items-center gap-2 animate-fade-in py-0.5 pl-11">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full text-xs font-medium">
            <span>✓</span>
            <span>{msg.content}</span>
          </div>
        </div>
      );
    }
    if (msg.statusType === "thinking") {
      return (
        <div className="flex items-start gap-3 animate-fade-in py-1">
          <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white text-sm">💭</span>
          </div>
          <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-xs text-gray-500 italic max-w-[75%]">
            {msg.content}
          </div>
        </div>
      );
    }
    if (msg.statusType === "error") {
      return (
        <div className="flex items-center gap-2 animate-fade-in py-1 pl-11">
          <div className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs">
            ❌ {msg.content}
          </div>
        </div>
      );
    }
    return null;
  }

  // Assistant message
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
      </div>
      <div className="max-w-[80%]">
        <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
          <div className="text-sm whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }} />
        </div>
        <span className="text-[10px] text-gray-400 mt-1 ml-1 block">{formatTime(msg.timestamp)}</span>
      </div>
    </div>
  );
}

function formatMarkdown(text: string): string {
  let result = text
    // Uber ride links → branded black button
    .replace(/\[([^\]]+)\]\((https?:\/\/m\.uber\.com[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-black hover:bg-gray-800 text-white rounded-full text-xs font-medium no-underline transition-colors">🚗 $1</a>')
    // Google Calendar links → green button
    .replace(/\[([^\]]+)\]\((https?:\/\/calendar\.google\.com[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs font-medium no-underline transition-colors">📅 $1</a>')
    // Other markdown links [text](url) to HTML links
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-teal-600 hover:underline">$1</a>')
    // Convert markdown links [text](tel:...) to call buttons
    .replace(/\[([^\]]+)\]\((tel:[^)]+)\)/g,
      '<a href="$2" class="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-full text-xs font-medium no-underline border border-teal-200 transition-colors">📞 $1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>")
    .replace(/^(\d+)\.\s/gm, "<span class='font-semibold text-teal-700'>$1.</span> ")
    .replace(/- \*\*/g, "• <strong>")
    .replace(/^- /gm, "• ");

  // Phone numbers → clickable "Call to Reserve" buttons (only if not already inside an <a> tag)
  result = result.replace(
    /(?<!["=])(?:📞\s*)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?![^<]*<\/a>)/g,
    '<a href="tel:$1" class="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-full text-xs font-medium no-underline border border-teal-200 transition-colors">📞 Call to Reserve: $1</a>'
  );

  // Bare URLs not already in <a> tags → clickable links
  result = result.replace(
    /(?<!["=])(https?:\/\/[^\s<)"]+)(?![^<]*<\/a>)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-teal-600 hover:underline text-xs">🔗 $1</a>'
  );

  return result;
}
