"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Friend, AgentStep, fetchFriends, streamPlan } from "@/lib/api";
import ChatMessage, { ChatMsg, RecommendationData } from "@/components/ChatMessage";
import MapPanel, { UserLocation } from "@/components/MapPanel";
import { ScanState } from "@/components/FriendLocatorOverlay";

// ─── Utils ───
function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

// ─── Preferences state ───
interface Prefs {
  cuisines: string[];
  budget: number;
  occasion: string;
  mode: "safe" | "adventurous";
  maxDrive: number;
  blacklist: string;
}

const DEFAULT_PREFS: Prefs = {
  cuisines: [],
  budget: 40,
  occasion: "friends",
  mode: "safe",
  maxDrive: 30,
  blacklist: "",
};

const OCCASIONS = ["Friends", "Birthday", "Date", "Formal"];
const CUISINE_OPTIONS = ["Japanese", "Italian", "BBQ", "Mexican", "Chinese", "Indian", "Korean", "Thai", "Mediterranean", "American"];

// ─── Helpers ───
let msgId = 0;
function mkMsg(role: ChatMsg["role"], content: string, extra?: Partial<ChatMsg>): ChatMsg {
  return { id: `${++msgId}-${Date.now()}`, role, content, timestamp: new Date(), ...extra };
}

function summarizeToolResult(tool: string, result: unknown): string {
  if (tool === "get_friends_info" && result && typeof result === "object") {
    const names = Object.keys(result as Record<string, unknown>);
    return `Found ${names.length} friends: ${names.join(", ")}`;
  }
  if (tool === "search_restaurants" && Array.isArray(result)) {
    return `Found ${result.length} candidate restaurants`;
  }
  if (tool === "calculate_drive_times" && Array.isArray(result)) {
    const friends = [...new Set(result.map((d: { friend: string }) => d.friend))];
    const rests = [...new Set(result.map((d: { restaurant: string }) => d.restaurant))];
    return `Calculated ${friends.length} x ${rests.length} drive time matrix`;
  }
  if (tool === "validate_restaurants" && result && typeof result === "object") {
    const r = result as { kept_count?: number; removed_count?: number };
    return `${r.kept_count ?? 0} passed, ${r.removed_count ?? 0} filtered out`;
  }
  if (tool === "rank_and_score" && Array.isArray(result)) {
    const top = result[0] as { name?: string; total_score?: number } | undefined;
    return `Ranked ${result.length} restaurants${top ? ` — #1: ${top.name} (${top.total_score}/10)` : ""}`;
  }
  if (tool === "get_restaurant_details" && Array.isArray(result)) {
    return `Fetched details for ${result.length} restaurants`;
  }
  if (tool === "book_ride" && result && typeof result === "object") {
    const r = result as { restaurant?: string };
    return `Ride links ready for ${r.restaurant || "restaurant"}`;
  }
  if (tool === "add_to_calendar" && result && typeof result === "object") {
    const r = result as { restaurant?: string; date?: string; time?: string };
    return `Calendar event: ${r.restaurant || "dinner"} on ${r.date || ""} ${r.time || ""}`;
  }
  return "Done";
}

// ─── Extract restaurant data from tool results for the map ───
interface RestaurantMapData {
  name: string;
  lat: number;
  lng: number;
  rating?: number;
  price_level?: number | null;
  address?: string;
  total_ratings?: number;
}

function extractRestaurants(steps: AgentStep[]): RestaurantMapData[] {
  // Build lookups from search results by name and place_id
  const byName: Map<string, RestaurantMapData> = new Map();
  const byPlaceId: Map<string, RestaurantMapData> = new Map();
  for (const step of steps) {
    if (step.type === "tool_result") {
      const data = step.content as { tool: string; result: unknown };
      if (data.tool === "search_restaurants" && Array.isArray(data.result)) {
        for (const r of data.result) {
          if (r.location) {
            const entry: RestaurantMapData = {
              name: r.name,
              lat: r.location.lat,
              lng: r.location.lng,
              rating: r.rating,
              price_level: r.price_level,
              address: r.address,
              total_ratings: r.total_ratings,
            };
            byName.set(r.name, entry);
            if (r.place_id) byPlaceId.set(r.place_id, entry);
          }
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type RankedEntry = { name: string; place_id?: string; rating?: number; price_level?: number; address?: string; total_ratings?: number; location?: { lat: number; lng: number } };

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step.type === "tool_result") {
      const data = step.content as { tool: string; result: unknown };
      if (data.tool === "rank_and_score" && Array.isArray(data.result)) {
        const top = (data.result as RankedEntry[]).slice(0, 3);
        const mapped: RestaurantMapData[] = [];
        for (const r of top) {
          // Match by place_id first (most reliable), then exact name, then fuzzy name
          const full = (r.place_id && byPlaceId.get(r.place_id))
            || byName.get(r.name)
            || [...byName.values()].find((a) => a.name.includes(r.name) || r.name.includes(a.name));

          if (full) {
            mapped.push({ ...full, rating: r.rating ?? full.rating, address: r.address ?? full.address });
          } else if (r.location) {
            mapped.push({ name: r.name, lat: r.location.lat, lng: r.location.lng, rating: r.rating, price_level: r.price_level, address: r.address, total_ratings: r.total_ratings });
          }
        }
        return mapped;
      }
    }
  }

  return Array.from(byName.values());
}

// ─── Extract drive times from tool results for the map ───
function extractDriveTimes(steps: AgentStep[]): Record<string, Record<string, string>> {
  // { "Alice": { "Restaurant A": "22 mins", ... }, ... }
  const result: Record<string, Record<string, string>> = {};
  for (const step of steps) {
    if (step.type === "tool_result") {
      const data = step.content as { tool: string; result: unknown };
      if (data.tool === "calculate_drive_times" && Array.isArray(data.result)) {
        for (const entry of data.result as { friend: string; restaurant: string; duration_text: string }[]) {
          if (!result[entry.friend]) result[entry.friend] = {};
          result[entry.friend][entry.restaurant] = entry.duration_text;
        }
      }
    }
  }
  return result;
}

// ─── Extract structured recommendation data from tool results ───
function extractRecommendations(steps: AgentStep[]): RecommendationData[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyObj = Record<string, any>;

  let ranked: AnyObj[] = [];
  let details: AnyObj[] = [];
  let yelpData: AnyObj[] = [];
  const driveEntries: AnyObj[] = [];

  for (const step of steps) {
    if (step.type !== "tool_result") continue;
    const data = step.content as { tool: string; result: unknown };
    if (data.tool === "rank_and_score" && Array.isArray(data.result)) {
      ranked = data.result as AnyObj[];
    }
    if (data.tool === "get_restaurant_details" && Array.isArray(data.result)) {
      details = data.result as AnyObj[];
    }
    if (data.tool === "get_yelp_info" && Array.isArray(data.result)) {
      yelpData = data.result as AnyObj[];
    }
    if (data.tool === "calculate_drive_times" && Array.isArray(data.result)) {
      for (const e of data.result as AnyObj[]) driveEntries.push(e);
    }
  }

  if (ranked.length === 0) return [];

  const top = ranked.slice(0, 3);

  const detailsByPlaceId = new Map<string, AnyObj>();
  const detailsByName = new Map<string, AnyObj>();
  for (const d of details) {
    if (d.place_id) detailsByPlaceId.set(d.place_id, d);
    if (d.name) detailsByName.set(d.name.toLowerCase(), d);
  }

  const yelpByName = new Map<string, AnyObj>();
  for (const y of yelpData) {
    if (y.name) yelpByName.set(y.name.toLowerCase(), y);
  }

  return top.map((r, i): RecommendationData => {
    const detail = detailsByPlaceId.get(r.place_id)
      || detailsByName.get(r.name?.toLowerCase())
      || {};
    const yelp = yelpByName.get(r.name?.toLowerCase()) || {};

    const perRestDrives = driveEntries
      .filter((d) => d.restaurant === r.name)
      .map((d) => ({ friend: d.friend as string, duration: d.duration_text as string }));

    return {
      rank: i + 1,
      name: r.name || "",
      address: r.address || "",
      rating: r.rating || 0,
      totalRatings: r.total_ratings || 0,
      priceLevel: r.price_level ?? null,
      totalScore: r.total_score || 0,
      breakdown: r.breakdown || { drive_score: 0, rating_score: 0, fairness_score: 0, price_score: 0 },
      driveStats: r.drive_stats || { avg_minutes: null, max_minutes: null, spread_minutes: null },
      location: r.location,
      placeId: r.place_id || "",
      phone: detail.phone || undefined,
      website: detail.website || undefined,
      googleMapsUrl: detail.google_maps_url || undefined,
      hours: detail.hours || undefined,
      summary: detail.summary || undefined,
      googleReviews: detail.reviews || undefined,
      yelpRating: yelp.yelp_rating ?? null,
      yelpReviewCount: yelp.yelp_review_count ?? null,
      yelpPrice: yelp.yelp_price ?? null,
      yelpUrl: yelp.yelp_url ?? null,
      estimatedPerPerson: yelp.estimated_per_person ?? null,
      popularDishes: yelp.popular_dishes || undefined,
      driveTimes: perRestDrives.length > 0 ? perRestDrives : undefined,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
export default function Home() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [input, setInput] = useState("");
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [savedMarkers, setSavedMarkers] = useState<RestaurantMapData[]>([]);
  const [savedDriveTimes, setSavedDriveTimes] = useState<Record<string, Record<string, string>>>({});

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [friendScanState, setFriendScanState] = useState<ScanState>("idle");

  // Dropdown open state
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const friendsRef = useRef<HTMLDivElement>(null);
  const prefsRef = useRef<HTMLDivElement>(null);
  const streamingMsgId = useRef<string | null>(null);

  // Load friends
  useEffect(() => {
    fetchFriends()
      .then((f) => {
        setFriends(f);
        setMessages([
          mkMsg("assistant",
            "Hello! I'm your AI dining planner. I can help you find the perfect restaurant for your group.\n\n" +
            "To get started, use the menu above to:\n" +
            "• Select friends who are joining\n" +
            "• Set your dining preferences\n" +
            "• Then click 'Run Agent' to see my recommendations!\n\n" +
            "Or just chat with me about what you're looking for!"
          ),
        ]);
      })
      .catch(() => {
        setMessages([mkMsg("status", "Cannot connect to backend. Is the server running on port 8001?", { statusType: "error" })]);
      });
  }, []);

  // Get user's location via browser geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        // Reverse geocode to get address
        let address = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        try {
          const gkey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";
          if (gkey) {
            const res = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${gkey}`
            );
            const data = await res.json();
            if (data.results?.[0]) {
              address = data.results[0].formatted_address;
            }
          }
        } catch { /* fallback to coords */ }
        setUserLocation({ lat: latitude, lng: longitude, address });
      },
      () => { /* geolocation denied or unavailable — no marker shown */ }
    );
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (friendsRef.current && !friendsRef.current.contains(e.target as Node)) setFriendsOpen(false);
      if (prefsRef.current && !prefsRef.current.contains(e.target as Node)) setPrefsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Build message from prefs
  const buildAgentMessage = useCallback(() => {
    const parts: string[] = [];
    if (selectedFriends.length > 0) parts.push(`I want to have dinner with ${selectedFriends.join(", ")}.`);
    if (prefs.cuisines.length > 0) parts.push(`We want ${prefs.cuisines.join(" or ")} food.`);
    parts.push(`Budget: $${prefs.budget} per person.`);
    parts.push(`Occasion: ${prefs.occasion}.`);
    parts.push(`Mode: ${prefs.mode === "safe" ? "safe picks (well-reviewed)" : "adventurous (hidden gems)"}.`);
    parts.push(`Max drive: ${prefs.maxDrive} minutes.`);
    if (prefs.blacklist.trim()) parts.push(`Avoid: ${prefs.blacklist}.`);
    return parts.join(" ");
  }, [selectedFriends, prefs]);

  const toggleCuisine = (c: string) => {
    setPrefs((prev) => ({
      ...prev,
      cuisines: prev.cuisines.includes(c) ? prev.cuisines.filter((x) => x !== c) : [...prev.cuisines, c],
    }));
  };

  // Send message to agent
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isRunning) return;

    setMessages((prev) => [...prev, mkMsg("user", text)]);
    setIsRunning(true);
    setAgentSteps([]);

    try {
      await streamPlan(
        text,
        sessionId,
        (step: AgentStep) => {
          setAgentSteps((prev) => [...prev, step]);

          if (step.type === "text_delta") {
            const delta = step.content as string;
            setMessages((prev) => {
              if (streamingMsgId.current) {
                const idx = prev.findIndex((m) => m.id === streamingMsgId.current);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], content: updated[idx].content + delta };
                  return updated;
                }
              }
              // Start as thinking style (small italic) — final_done will promote to assistant
              const newMsg = mkMsg("status", delta, { statusType: "thinking" });
              streamingMsgId.current = newMsg.id;
              return [...prev, newMsg];
            });
          } else if (step.type === "thinking_done") {
            streamingMsgId.current = null;
          } else if (step.type === "final_done") {
            // Promote current streaming message to assistant style
            if (streamingMsgId.current) {
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === streamingMsgId.current);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = { ...updated[idx], role: "assistant", statusType: undefined };
                  return updated;
                }
                return prev;
              });
            }
            streamingMsgId.current = null;
          } else if (step.type === "tool_call") {
            const data = step.content as { tool: string };
            if (data.tool === "get_friends_info") {
              setFriendScanState("scanning");
            }
            setMessages((prev) => [
              ...prev,
              mkMsg("status", "", {
                statusType: "tool_call",
                toolName: data.tool,
                ...(data.tool === "get_friends_info" ? { friendNames: [...selectedFriends] } : {}),
              }),
            ]);
          } else if (step.type === "tool_result") {
            const data = step.content as { tool: string; result: unknown };
            if (data.tool === "get_friends_info") {
              setFriendScanState("found");
            }
            setMessages((prev) => {
              const idx = findLastIndex(prev, (m) => m.statusType === "tool_call" && m.toolName === data.tool);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  statusType: "tool_result",
                  content: summarizeToolResult(data.tool, data.result),
                };
                return updated;
              }
              return [
                ...prev,
                mkMsg("status", summarizeToolResult(data.tool, data.result), { statusType: "tool_result" }),
              ];
            });
          } else if (step.type === "error") {
            setMessages((prev) => [
              ...prev,
              mkMsg("status", step.content as string, { statusType: "error" }),
            ]);
          }
        },
        (id: string) => setSessionId(id),
        () => setIsRunning(false),
        (err) => {
          setMessages((prev) => [...prev, mkMsg("status", err, { statusType: "error" })]);
          setIsRunning(false);
        },
        userLocation
      );
    } catch (err) {
      setMessages((prev) => [...prev, mkMsg("status", String(err), { statusType: "error" })]);
      setIsRunning(false);
    }
  }, [isRunning, sessionId, userLocation, selectedFriends]);

  const handleRunAgent = () => {
    if (selectedFriends.length === 0) {
      setMessages((prev) => [...prev, mkMsg("status", "Please select at least one friend first!", { statusType: "error" })]);
      return;
    }
    const msg = buildAgentMessage();
    sendMessage(msg);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
  };

  const toggleFriend = (name: string) => {
    setSelectedFriends((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  // Extract current markers from steps; fall back to saved markers while loading
  const currentMarkers = extractRestaurants(agentSteps);
  const currentDriveTimes = extractDriveTimes(agentSteps);

  const restaurantMarkers = currentMarkers.length > 0 ? currentMarkers : savedMarkers;
  const driveTimes = Object.keys(currentDriveTimes).length > 0 ? currentDriveTimes : savedDriveTimes;

  // When agent run finishes: promote the last thinking message to assistant style,
  // extract recommendation cards, and save map markers
  useEffect(() => {
    if (!isRunning) {
      const recs = extractRecommendations(agentSteps);

      setMessages((prev) => {
        const idx = findLastIndex(prev, (m) => m.role === "status" && m.statusType === "thinking");
        if (idx < 0) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], role: "assistant", statusType: undefined };

        const content = updated[idx].content.trimEnd();
        if (!/[.!?。！？:：)\]】\n]$/.test(content)) {
          for (let j = idx + 1; j < updated.length; j++) {
            if (updated[j].role === "assistant") {
              updated[idx] = { ...updated[idx], content: updated[idx].content + updated[j].content };
              updated.splice(j, 1);
              break;
            }
          }
        }

        if (recs.length > 0) {
          updated[idx] = { ...updated[idx], recommendations: recs };
        }

        return updated;
      });

      if (currentMarkers.length > 0) {
        setSavedMarkers(currentMarkers);
        setSavedDriveTimes(currentDriveTimes);
      }
    }
  }, [isRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ─── Menu Bar ─── */}
      <header className="bg-white border-b border-gray-200 shadow-sm shrink-0 z-20">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-blue-600 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">AI Dining Planner</h1>
                <p className="text-xs text-gray-500">Intelligent group restaurant matching</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              {/* Friends dropdown */}
              <div ref={friendsRef} className="relative">
                <button
                  onClick={() => { setFriendsOpen(!friendsOpen); setPrefsOpen(false); }}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors border border-gray-200"
                >
                  <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                  <span className="text-sm font-medium text-gray-700">
                    {selectedFriends.length > 0 ? `${selectedFriends.length} Friend${selectedFriends.length === 1 ? "" : "s"}` : "Select Friends"}
                  </span>
                  <svg className={`w-4 h-4 text-gray-500 transition-transform ${friendsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {friendsOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-50">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Select Friends</h3>
                    <div className="space-y-1">
                      {friends.map((f) => (
                        <label key={f.name} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${
                            selectedFriends.includes(f.name) ? "bg-gradient-to-br from-teal-500 to-blue-600" : "bg-gray-300"
                          }`}>
                            {f.name[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{f.name}</p>
                            <p className="text-[11px] text-gray-400 truncate">{f.location.address}</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedFriends.includes(f.name)}
                            onChange={() => toggleFriend(f.name)}
                            className="w-4 h-4 rounded border-gray-300 accent-teal-500"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Preferences dropdown */}
              <div ref={prefsRef} className="relative">
                <button
                  onClick={() => { setPrefsOpen(!prefsOpen); setFriendsOpen(false); }}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors border border-gray-200"
                >
                  <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  <span className="text-sm font-medium text-gray-700">Preferences</span>
                  <svg className={`w-4 h-4 text-gray-500 transition-transform ${prefsOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {prefsOpen && (
                  <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-xl border border-gray-200 p-5 z-50 max-h-[600px] overflow-y-auto space-y-4">
                    <h3 className="text-sm font-semibold text-gray-900">Dining Preferences</h3>

                    {/* Cuisines */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-2">Cuisines</label>
                      <div className="flex flex-wrap gap-2">
                        {CUISINE_OPTIONS.map((c) => (
                          <button key={c} type="button" onClick={() => toggleCuisine(c)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                              prefs.cuisines.includes(c) ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >{c}</button>
                        ))}
                      </div>
                    </div>

                    {/* Budget */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-2">Budget: ${prefs.budget}/person</label>
                      <input type="range" min={10} max={80} step={5} value={prefs.budget}
                        onChange={(e) => setPrefs({ ...prefs, budget: Number(e.target.value) })}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-500"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1"><span>$10</span><span>$80</span></div>
                    </div>

                    {/* Mode */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-2">Mode</label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setPrefs({ ...prefs, mode: "safe" })}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${prefs.mode === "safe" ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                        >Safe Choice</button>
                        <button type="button" onClick={() => setPrefs({ ...prefs, mode: "adventurous" })}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${prefs.mode === "adventurous" ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
                        >Try Something New</button>
                      </div>
                    </div>

                    {/* Occasion */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-2">Occasion</label>
                      <select value={prefs.occasion} onChange={(e) => setPrefs({ ...prefs, occasion: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                        {OCCASIONS.map((o) => <option key={o} value={o.toLowerCase()}>{o}</option>)}
                      </select>
                    </div>

                    {/* Max Commute */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-2">Max Commute: {prefs.maxDrive} min</label>
                      <input type="range" min={10} max={60} step={5} value={prefs.maxDrive}
                        onChange={(e) => setPrefs({ ...prefs, maxDrive: Number(e.target.value) })}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-500"
                      />
                      <div className="flex justify-between text-xs text-gray-500 mt-1"><span>10 min</span><span>60 min</span></div>
                    </div>

                    {/* Avoid */}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-2">Avoid (Optional)</label>
                      <textarea value={prefs.blacklist} onChange={(e) => setPrefs({ ...prefs, blacklist: e.target.value })}
                        placeholder="e.g., seafood allergies, loud atmospheres..."
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* New Chat */}
              {sessionId && (
                <button
                  onClick={() => {
                    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001"}/api/session/${sessionId}`, { method: "DELETE" });
                    setSessionId(null);
                    setAgentSteps([]);
                    setSavedMarkers([]);
                    setSavedDriveTimes({});
                    setFriendScanState("idle");
                    setMessages([
                      mkMsg("assistant",
                        "Chat cleared! Select friends and preferences, then click 'Run Agent' to start a new search."
                      ),
                    ]);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  New Chat
                </button>
              )}

              {/* Run Agent */}
              <button onClick={handleRunAgent} disabled={isRunning}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
                  isRunning
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-teal-500 to-blue-600 text-white hover:shadow-lg shadow-sm"
                }`}
              >
                {isRunning ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Working...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                    <span>Run Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ─── Main Content — Split Layout ─── */}
      <div className="p-6">
        <div className="max-w-[1800px] mx-auto">
          <div className="grid grid-cols-5 gap-6" style={{ height: "calc(100vh - 140px)" }}>
            {/* Left: Chat (2 cols = 40%) */}
            <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
              {/* Chat header */}
              <div className="px-6 py-4 border-b border-gray-200 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-blue-600 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900">AI Dining Assistant</h2>
                    <p className="text-xs text-gray-500">Ask me about restaurant recommendations</p>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map((msg) => (
                  <ChatMessage key={msg.id} msg={msg} />
                ))}
                {isRunning && messages[messages.length - 1]?.role !== "status" && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-teal-500 to-blue-600 rounded-lg flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0" />
                      </svg>
                    </div>
                    <div className="bg-gray-100 rounded-2xl px-4 py-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full dot-1" />
                        <span className="w-2 h-2 bg-gray-400 rounded-full dot-2" />
                        <span className="w-2 h-2 bg-gray-400 rounded-full dot-3" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-gray-200 shrink-0">
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    disabled={isRunning}
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <button type="submit" disabled={isRunning || !input.trim()}
                    className={`px-4 py-3 rounded-xl flex items-center justify-center transition-all ${
                      input.trim() && !isRunning
                        ? "bg-gradient-to-r from-teal-500 to-blue-600 text-white hover:shadow-lg"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                </form>
              </div>
            </div>

            {/* Right: Map (3 cols = 60%) */}
            <div className="col-span-3 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <MapPanel
                friends={friends}
                selectedFriends={selectedFriends}
                restaurantMarkers={restaurantMarkers}
                driveTimes={driveTimes}
                userLocation={userLocation}
                friendScanState={friendScanState}
                scanFriendNames={selectedFriends}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
