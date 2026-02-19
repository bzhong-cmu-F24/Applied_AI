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
    price_score?: number;
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

// ── Recommendation Cards (Figma design) ──
import { Star, MapPin, Phone, Globe, Map, ChevronDown, Clock, User, TrendingUp } from "lucide-react";

function renderStars(rating: number, size: "sm" | "xs" = "sm") {
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.25;
  const sz = size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3";
  return Array.from({ length: 5 }, (_, i) => (
    <Star
      key={i}
      className={`${sz} ${
        i < fullStars
          ? "fill-yellow-400 text-yellow-400"
          : i === fullStars && hasHalf
          ? "fill-yellow-400 text-yellow-400 opacity-50"
          : "text-gray-300"
      }`}
    />
  ));
}

function getScoreColor(score: number) {
  if (score >= 8) return "from-teal-500 to-emerald-500";
  if (score >= 6) return "from-blue-500 to-teal-500";
  return "from-gray-500 to-gray-600";
}

function priceLevelStr(level: number | null): string {
  if (level == null) return "N/A";
  return "$".repeat(Math.max(1, level));
}

function parseMinutes(duration: string): number | null {
  const m = duration.match(/(\d+)\s*min/);
  return m ? parseInt(m[1], 10) : null;
}

function RecommendationCard({ rec }: { rec: RecommendationData }) {
  const [showMore, setShowMore] = useState(false);

  const avgCommute = rec.driveTimes && rec.driveTimes.length > 0
    ? Math.round(
        rec.driveTimes.reduce((sum, dt) => sum + (parseMinutes(dt.duration) ?? 0), 0) / rec.driveTimes.length
      )
    : rec.driveStats.avg_minutes != null ? Math.round(rec.driveStats.avg_minutes) : null;

  const metrics = {
    drive: rec.breakdown.drive_score,
    rating: rec.breakdown.rating_score,
    fairness: rec.breakdown.fairness_score,
  };

  const mapUrl = rec.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.name + " " + rec.address)}`;

  return (
    <div
      className="rec-card bg-gradient-to-br from-white to-gray-50 rounded-xl shadow-md border border-gray-200 overflow-hidden"
      style={{ animation: `fadeSlideIn 0.4s ease-out ${(rec.rank - 1) * 0.12}s both` }}
    >
      {/* Gradient header */}
      <div className="relative bg-gradient-to-r from-teal-500 to-blue-600 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="px-2 py-0.5 bg-yellow-400 rounded-md text-xs font-bold text-gray-900 shrink-0">
              #{rec.rank}
            </div>
            <span className="text-white font-semibold text-sm truncate">{rec.name}</span>
          </div>
          <div className={`px-2.5 py-1 rounded-lg bg-gradient-to-r ${getScoreColor(rec.totalScore)} text-white font-bold text-sm shadow-sm shrink-0 ml-2`}>
            {rec.totalScore.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2.5">
        {/* Address */}
        <div className="flex items-start gap-1.5">
          <MapPin className="w-3 h-3 text-gray-400 mt-0.5 shrink-0" />
          <span className="text-xs text-gray-600 leading-tight">{rec.address}</span>
        </div>

        {/* Ratings */}
        <div className="flex items-center gap-4 pb-2.5 border-b border-gray-200">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-gray-500">Google</span>
            <div className="flex gap-0.5">{renderStars(rec.rating, "xs")}</div>
            <span className="text-xs font-bold text-gray-900">{rec.rating.toFixed(1)}</span>
            <span className="text-[10px] text-gray-400">({rec.totalRatings.toLocaleString()})</span>
          </div>
          {rec.yelpRating != null && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold text-gray-500">Yelp</span>
              <div className="flex gap-0.5">{renderStars(rec.yelpRating, "xs")}</div>
              <span className="text-xs font-bold text-gray-900">{rec.yelpRating.toFixed(1)}</span>
              {rec.yelpReviewCount != null && (
                <span className="text-[10px] text-gray-400">({rec.yelpReviewCount.toLocaleString()})</span>
              )}
            </div>
          )}
        </div>

        {/* Price & Commute stat boxes */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-purple-50 rounded-lg p-2">
            <div className="text-[10px] font-medium text-purple-600 mb-0.5">Price</div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold text-purple-900">{priceLevelStr(rec.priceLevel)}</span>
              {rec.estimatedPerPerson != null && (
                <span className="text-[10px] text-purple-600">~${rec.estimatedPerPerson}/person</span>
              )}
            </div>
          </div>
          <div className="bg-blue-50 rounded-lg p-2">
            <div className="text-[10px] font-medium text-blue-600 mb-0.5">Avg Commute</div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-600" />
              <span className="text-sm font-bold text-blue-900">
                {avgCommute != null ? `${avgCommute} min` : "N/A"}
              </span>
            </div>
          </div>
        </div>

        {/* Commute breakdown per person */}
        {rec.driveTimes && rec.driveTimes.length > 0 && (
          <div className="space-y-1">
            {rec.driveTimes.map((dt, i) => (
              <div key={dt.friend} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-teal-400 to-blue-500 flex items-center justify-center">
                    <User className="w-2.5 h-2.5 text-white" />
                  </div>
                  <span className="font-medium text-gray-700">{dt.friend}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-gray-400" />
                  <span className="font-semibold text-gray-900">{dt.duration}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Metrics — compact or expanded */}
        {!showMore ? (
          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-gray-200">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="text-center">
                <div className="text-[10px] text-gray-500 capitalize mb-0.5">{key}</div>
                <div className="text-sm font-bold text-gray-900">{value.toFixed(1)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1.5 pt-2 border-t border-gray-200">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-gray-600 w-12 capitalize">{key}</span>
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-500 to-blue-600 rounded-full transition-all duration-500"
                    style={{ width: `${(value / 10) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-900 w-6 text-right">{value.toFixed(1)}</span>
              </div>
            ))}

            {/* Popular dishes in expanded view */}
            {rec.popularDishes && rec.popularDishes.length > 0 && (
              <div className="pt-1.5">
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
              <p className="text-[11px] text-gray-600 pt-1 leading-relaxed italic">&ldquo;{rec.summary}&rdquo;</p>
            )}

            {/* Hours */}
            {rec.hours && rec.hours.length > 0 && (
              <div className="pt-1.5">
                <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Hours</span>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {rec.hours.map((h) => (
                    <span key={h} className="text-[10px] text-gray-600">{h}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Google reviews */}
            {rec.googleReviews && rec.googleReviews.length > 0 && (
              <div className="pt-1.5">
                <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">Top Reviews</span>
                <div className="mt-1 space-y-1.5">
                  {rec.googleReviews.map((r, i) => (
                    <div key={i} className="bg-white rounded-lg px-2.5 py-2 border border-gray-100">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="flex gap-0.5">{renderStars(r.rating, "xs")}</div>
                        <span className="text-[10px] text-gray-500">{r.author}</span>
                      </div>
                      <p className="text-[11px] text-gray-600 leading-relaxed">{r.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rec.yelpUrl && (
              <a href={rec.yelpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:underline font-medium pt-1">
                View on Yelp
              </a>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 pt-2">
          {rec.phone && (
            <a href={`tel:${rec.phone}`} className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 text-[10px] font-medium flex-1">
              <Phone className="w-3 h-3" />
              <span>Call</span>
            </a>
          )}
          {rec.website && (
            <a href={rec.website} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 text-[10px] font-medium flex-1">
              <Globe className="w-3 h-3" />
              <span>Site</span>
            </a>
          )}
          <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-700 text-[10px] font-medium flex-1">
            <Map className="w-3 h-3" />
            <span>Map</span>
          </a>
          <button
            onClick={() => setShowMore(!showMore)}
            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-gradient-to-r from-teal-500 to-blue-600 hover:from-teal-600 hover:to-blue-700 transition-all text-white text-[10px] font-medium shadow-sm"
          >
            <TrendingUp className="w-3 h-3" />
            <span>{showMore ? "Less" : "More"}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showMore ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
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
