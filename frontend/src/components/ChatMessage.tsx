"use client";

import { useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export type MessageRole = "user" | "assistant" | "status";

export interface RecommendationData {
  rank: number;
  name: string;
  address: string;
  rating: number;
  totalRatings: number;
  priceLevel: number | null;
  totalScore: number;
  breakdown: {
    drive_score: number;
    rating_score: number;
    fairness_score: number;
    price_score: number;
  };
  driveStats: {
    avg_minutes: number | null;
    max_minutes: number | null;
    spread_minutes: number | null;
  };
  location?: { lat: number; lng: number };
  placeId: string;
  phone?: string;
  website?: string;
  googleMapsUrl?: string;
  hours?: string[];
  summary?: string;
  googleReviews?: { author: string; rating: number; text: string; time: string }[];
  yelpRating?: number | null;
  yelpReviewCount?: number | null;
  yelpPrice?: string | null;
  yelpUrl?: string | null;
  estimatedPerPerson?: number | null;
  popularDishes?: string[];
  driveTimes?: { friend: string; duration: string }[];
}

export interface ChatMsg {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  statusType?: "thinking" | "tool_call" | "tool_result" | "error";
  toolName?: string;
  friendNames?: string[];
  recommendations?: RecommendationData[];
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

function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children, ...props }) => {
            const url = href || "";
            // Uber ride links → branded black button
            if (/^https?:\/\/m\.uber\.com/i.test(url)) {
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-black hover:bg-gray-800 text-white rounded-full text-xs font-medium no-underline transition-colors"
                  {...props}
                >
                  🚗 {children}
                </a>
              );
            }
            // Google Calendar links → green button
            if (/^https?:\/\/calendar\.google\.com/i.test(url)) {
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs font-medium no-underline transition-colors"
                  {...props}
                >
                  📅 {children}
                </a>
              );
            }
            // tel: links → call button
            if (/^tel:/i.test(url)) {
              return (
                <a
                  href={url}
                  className="inline-flex items-center gap-1 mt-1 mb-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-full text-xs font-medium no-underline border border-teal-200 transition-colors"
                  {...props}
                >
                  📞 {children}
                </a>
              );
            }
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-700 hover:underline"
                {...props}
              >
                {children}
              </a>
            );
          },
          p: ({ children, ...props }) => (
            <p className="chat-md-p" {...props}>
              {children}
            </p>
          ),
          ul: ({ children, ...props }) => (
            <ul className="chat-md-ul" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="chat-md-ol" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="chat-md-li" {...props}>
              {children}
            </li>
          ),
          code: ({ children, ...props }) => (
            <code className="chat-md-code" {...props}>
              {children}
            </code>
          ),
          pre: ({ children, ...props }) => (
            <pre className="chat-md-pre" {...props}>
              {children}
            </pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
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

// ── Recommendation Cards ──
const RANK_STYLES = [
  { badge: "bg-gradient-to-r from-amber-400 to-yellow-500", ring: "ring-amber-200", label: "#1 Top Pick" },
  { badge: "bg-gradient-to-r from-slate-300 to-slate-400", ring: "ring-slate-200", label: "#2" },
  { badge: "bg-gradient-to-r from-amber-600 to-orange-500", ring: "ring-orange-200", label: "#3" },
];

function Stars({ rating, max = 5 }: { rating: number; max?: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.25;
  return (
    <span className="inline-flex items-center gap-[1px]">
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} className={`w-3.5 h-3.5 ${i < full ? "text-amber-400" : i === full && half ? "text-amber-300" : "text-gray-200"}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </span>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-500 w-14 shrink-0 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(value / 10) * 100}%` }} />
      </div>
      <span className="text-[10px] text-gray-600 font-medium w-6 tabular-nums">{value.toFixed(1)}</span>
    </div>
  );
}

function PriceLevel({ level }: { level: number | null }) {
  if (level === null || level === undefined) return <span className="text-xs text-gray-400">Price N/A</span>;
  return (
    <span className="text-xs font-medium">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={i < level ? "text-emerald-600" : "text-gray-200"}>$</span>
      ))}
    </span>
  );
}

function RecommendationCard({ rec }: { rec: RecommendationData }) {
  const [expanded, setExpanded] = useState(false);
  const style = RANK_STYLES[rec.rank - 1] || RANK_STYLES[2];

  return (
    <div
      className={`rec-card bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden ${rec.rank === 1 ? `ring-2 ${style.ring}` : ""}`}
      style={{ animation: `fadeSlideIn 0.4s ease-out ${(rec.rank - 1) * 0.12}s both` }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className={`${style.badge} text-white text-[11px] font-bold rounded-lg px-2 py-1 shrink-0 shadow-sm`}>
            {style.label}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 leading-snug">{rec.name}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">{rec.address}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold text-teal-600">{rec.totalScore.toFixed(1)}<span className="text-xs text-gray-400 font-normal">/10</span></div>
          </div>
        </div>

        {/* Ratings row */}
        <div className="flex items-center gap-4 mt-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-400 font-medium">Google</span>
            <Stars rating={rec.rating} />
            <span className="text-xs font-semibold text-gray-700">{rec.rating.toFixed(1)}</span>
            <span className="text-[10px] text-gray-400">({rec.totalRatings.toLocaleString()})</span>
          </div>
          {rec.yelpRating != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 font-medium">Yelp</span>
              <Stars rating={rec.yelpRating} />
              <span className="text-xs font-semibold text-gray-700">{rec.yelpRating.toFixed(1)}</span>
              {rec.yelpReviewCount != null && (
                <span className="text-[10px] text-gray-400">({rec.yelpReviewCount.toLocaleString()})</span>
              )}
            </div>
          )}
          <PriceLevel level={rec.priceLevel} />
          {rec.estimatedPerPerson != null && (
            <span className="text-[10px] text-gray-500">~${rec.estimatedPerPerson}/person</span>
          )}
        </div>

        {/* Drive time chips */}
        {rec.driveTimes && rec.driveTimes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {rec.driveTimes.map((dt) => (
              <span key={dt.friend} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-[10px] text-blue-700 font-medium">
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                {dt.friend}: {dt.duration}
              </span>
            ))}
          </div>
        )}

        {/* Score breakdown */}
        <div className="mt-3 space-y-1">
          <ScoreBar label="Drive" value={rec.breakdown.drive_score} color="bg-blue-400" />
          <ScoreBar label="Rating" value={rec.breakdown.rating_score} color="bg-amber-400" />
          <ScoreBar label="Fairness" value={rec.breakdown.fairness_score} color="bg-emerald-400" />
          <ScoreBar label="Price" value={rec.breakdown.price_score} color="bg-purple-400" />
        </div>

        {/* Popular dishes */}
        {rec.popularDishes && rec.popularDishes.length > 0 && (
          <div className="mt-3">
            <span className="text-[10px] text-gray-500 font-medium">Popular dishes</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {rec.popularDishes.map((dish) => (
                <span key={dish} className="px-2 py-0.5 bg-orange-50 text-orange-700 text-[10px] rounded-full font-medium">{dish}</span>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {rec.summary && (
          <p className="text-[11px] text-gray-600 mt-2.5 leading-relaxed italic">&ldquo;{rec.summary}&rdquo;</p>
        )}
      </div>

      {/* Action bar + expandable details */}
      <div className="border-t border-gray-100 px-4 py-2 flex items-center gap-2">
        {rec.phone && (
          <a href={`tel:${rec.phone}`} className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-[11px] font-medium transition-colors border border-teal-200">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
            {rec.phone}
          </a>
        )}
        {rec.website && (
          <a href={rec.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg text-[11px] font-medium transition-colors border border-gray-200">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
            Website
          </a>
        )}
        {rec.googleMapsUrl && (
          <a href={rec.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg text-[11px] font-medium transition-colors border border-gray-200">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" /></svg>
            Map
          </a>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
        >
          {expanded ? "Less" : "More"}
          <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 space-y-3">
          {rec.hours && rec.hours.length > 0 && (
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Hours</span>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {rec.hours.map((h) => (
                  <span key={h} className="text-[10px] text-gray-600">{h}</span>
                ))}
              </div>
            </div>
          )}
          {rec.googleReviews && rec.googleReviews.length > 0 && (
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Top Google Reviews</span>
              <div className="mt-1 space-y-1.5">
                {rec.googleReviews.map((r, i) => (
                  <div key={i} className="bg-white rounded-lg px-2.5 py-2 border border-gray-100">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Stars rating={r.rating} />
                      <span className="text-[10px] text-gray-500">{r.author}</span>
                    </div>
                    <p className="text-[11px] text-gray-600 leading-relaxed">{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {rec.yelpUrl && (
            <a href={rec.yelpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:underline font-medium">
              View on Yelp
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function RecommendationCards({ recommendations }: { recommendations: RecommendationData[] }) {
  return (
    <div className="w-full space-y-3 mt-1">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-gray-900">Top Recommendations</span>
      </div>
      {recommendations.map((rec) => (
        <RecommendationCard key={rec.rank} rec={rec} />
      ))}
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
          <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-xs text-gray-700 max-w-[75%]">
            <Markdown text={msg.content} className="chat-markdown" />
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

  // Assistant message with recommendation cards
  if (msg.recommendations && msg.recommendations.length > 0) {
    return (
      <div className="animate-fade-in">
        <RecommendationCards recommendations={msg.recommendations} />
        <span className="text-[10px] text-gray-400 mt-1 ml-11 block">{formatTime(msg.timestamp)}</span>
      </div>
    );
  }

  // Regular assistant message
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
      </div>
      <div className="max-w-[80%]">
        <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
          <Markdown text={msg.content} className="chat-markdown text-sm leading-relaxed" />
        </div>
        <span className="text-[10px] text-gray-400 mt-1 ml-1 block">{formatTime(msg.timestamp)}</span>
      </div>
    </div>
  );
}
