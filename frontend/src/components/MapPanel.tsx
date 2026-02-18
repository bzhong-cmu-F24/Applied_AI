"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { GoogleMap, useJsApiLoader, MarkerF, InfoWindowF } from "@react-google-maps/api";
import { Friend } from "@/lib/api";
import FriendLocatorOverlay, { ScanState } from "./FriendLocatorOverlay";

export interface RestaurantMarker {
  name: string;
  lat: number;
  lng: number;
  rating?: number;
  price_level?: number | null;
  address?: string;
  total_ratings?: number;
}

export interface UserLocation {
  lat: number;
  lng: number;
  address: string;
}

interface Props {
  friends: Friend[];
  selectedFriends: string[];
  restaurantMarkers?: RestaurantMarker[];
  driveTimes?: Record<string, Record<string, string>>; // { friendName: { restaurantName: "22 mins" } }
  userLocation?: UserLocation | null;
  friendScanState?: ScanState;
  scanFriendNames?: string[];
}

const GMAP_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "";

const mapContainerStyle = { width: "100%", height: "100%" };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: false,
  styles: [
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  ],
};

function PriceLevel({ level }: { level: number | null | undefined }) {
  if (level == null) return <span className="text-gray-400 text-xs">Price N/A</span>;
  return (
    <span className="text-green-700 font-semibold text-xs">
      {"$".repeat(level)}
      <span className="text-gray-300">{"$".repeat(4 - level)}</span>
    </span>
  );
}

export default function MapPanel({ friends, selectedFriends, restaurantMarkers = [], driveTimes = {}, userLocation, friendScanState = "idle", scanFriendNames = [] }: Props) {
  const [selectedMarker, setSelectedMarker] = useState<{
    type: "friend" | "restaurant" | "me";
    index: number;
  } | null>(null);

  // Staggered friend marker reveal — wait for overlay to fade, then drop one by one
  const [revealedFriendCount, setRevealedFriendCount] = useState(0);

  useEffect(() => {
    if (friendScanState === "found") {
      // Overlay fades at ~1.4s and takes 1s to fade out → start at ~2.2s
      const startDelay = setTimeout(() => {
        let count = 0;
        const total = selectedFriends.length;
        const interval = setInterval(() => {
          count++;
          setRevealedFriendCount(count);
          if (count >= total) clearInterval(interval);
        }, 250);
        // reveal the first one immediately
        setRevealedFriendCount(1);
        return () => clearInterval(interval);
      }, 2200);
      return () => {
        clearTimeout(startDelay);
      };
    } else {
      setRevealedFriendCount(0);
    }
  }, [friendScanState, selectedFriends.length]);

  // Staggered restaurant marker reveal — DROP in one by one when new results arrive
  const [revealedRestCount, setRevealedRestCount] = useState(0);
  const prevRestKey = useRef("");

  useEffect(() => {
    const key = restaurantMarkers.map((r) => r.name).join("|");
    if (key === prevRestKey.current || restaurantMarkers.length === 0) {
      if (restaurantMarkers.length === 0) {
        setRevealedRestCount(0);
        prevRestKey.current = "";
      }
      return;
    }
    prevRestKey.current = key;
    setRevealedRestCount(0);
    let count = 0;
    // Small initial delay so the map can re-center first
    const start = setTimeout(() => {
      setRevealedRestCount(1);
      count = 1;
      const interval = setInterval(() => {
        count++;
        setRevealedRestCount(count);
        if (count >= restaurantMarkers.length) clearInterval(interval);
      }, 300);
    }, 400);
    return () => clearTimeout(start);
  }, [restaurantMarkers]);

  // Close any open InfoWindow when markers change
  useEffect(() => {
    setSelectedMarker(null);
  }, [restaurantMarkers, selectedFriends]);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: GMAP_KEY,
  });

  const selectedData = useMemo(
    () => friends.filter((f) => selectedFriends.includes(f.name)),
    [friends, selectedFriends]
  );

  const hasSelection = (selectedData.length > 0 && friendScanState !== "idle") || !!userLocation;

  // Calculate center and zoom
  const { center, zoom } = useMemo(() => {
    const points = [
      ...(userLocation ? [{ lat: userLocation.lat, lng: userLocation.lng }] : []),
      ...(friendScanState !== "idle" ? selectedData.map((f) => ({ lat: f.location.lat, lng: f.location.lng })) : []),
      ...restaurantMarkers.map((r) => ({ lat: r.lat, lng: r.lng })),
    ];
    if (points.length === 0) {
      return { center: { lat: 37.6, lng: -122.3 }, zoom: 10 };
    }
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const cLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    const spread = Math.max(
      Math.max(...lats) - Math.min(...lats),
      Math.max(...lngs) - Math.min(...lngs)
    );
    let z = 12;
    if (spread > 0.5) z = 9;
    else if (spread > 0.3) z = 10;
    else if (spread > 0.1) z = 11;
    return { center: { lat: cLat, lng: cLng }, zoom: z };
  }, [selectedData, restaurantMarkers, friendScanState, userLocation]);

  const onMapClick = useCallback(() => setSelectedMarker(null), []);

  // Empty state
  if (!hasSelection) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400">
        <svg className="w-16 h-16 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-sm">Select friends to see their locations</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Interactive Map */}
      <div className="flex-1 relative">
        <FriendLocatorOverlay state={friendScanState} friends={scanFriendNames} />
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={center}
          zoom={zoom}
          options={mapOptions}
          onClick={onMapClick}
        >
          {/* "Me" marker (blue) */}
          {userLocation && (
            <MarkerF
              key="me"
              position={{ lat: userLocation.lat, lng: userLocation.lng }}
              label={{
                text: "★",
                color: "white",
                fontWeight: "bold",
                fontSize: "12px",
              }}
              icon={{
                path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
                fillColor: "#3B82F6",
                fillOpacity: 1,
                strokeColor: "#1D4ED8",
                strokeWeight: 2,
                scale: 2.0,
                anchor: new google.maps.Point(12, 22),
                labelOrigin: new google.maps.Point(12, 9),
              }}
              onClick={() => setSelectedMarker({ type: "me", index: 0 })}
            >
              {selectedMarker?.type === "me" && (
                <InfoWindowF
                  position={{ lat: userLocation.lat, lng: userLocation.lng }}
                  onCloseClick={() => setSelectedMarker(null)}
                >
                  <div className="p-1 min-w-[120px]">
                    <p className="font-bold text-sm text-gray-900">Me</p>
                    <p className="text-xs text-gray-500 mt-0.5">📍 {userLocation.address}</p>
                  </div>
                </InfoWindowF>
              )}
            </MarkerF>
          )}

          {/* Friend markers (teal) — drop in one by one after overlay fades */}
          {selectedData.slice(0, revealedFriendCount).map((f, i) => (
            <MarkerF
              key={`friend-${f.name}`}
              position={{ lat: f.location.lat, lng: f.location.lng }}
              animation={google.maps.Animation.DROP}
              label={{
                text: String.fromCharCode(65 + i),
                color: "white",
                fontWeight: "bold",
                fontSize: "12px",
              }}
              icon={{
                path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
                fillColor: "#14B8A6",
                fillOpacity: 1,
                strokeColor: "#0D9488",
                strokeWeight: 2,
                scale: 1.8,
                anchor: new google.maps.Point(12, 22),
                labelOrigin: new google.maps.Point(12, 9),
              }}
              onClick={() => setSelectedMarker({ type: "friend", index: i })}
            >
              {selectedMarker?.type === "friend" && selectedMarker.index === i && (
                <InfoWindowF
                  position={{ lat: f.location.lat, lng: f.location.lng }}
                  onCloseClick={() => setSelectedMarker(null)}
                >
                  <div className="p-1 min-w-[160px]">
                    <p className="font-bold text-sm text-gray-900">{f.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">📍 {f.location.address}</p>
                    <div className="mt-1.5 text-xs text-gray-600">
                      <p>❤️ Likes: {f.preferences.likes.join(", ")}</p>
                      {f.preferences.dislikes.length > 0 && (
                        <p>👎 Dislikes: {f.preferences.dislikes.join(", ")}</p>
                      )}
                      {f.preferences.allergies.length > 0 && (
                        <p>⚠️ Allergies: {f.preferences.allergies.join(", ")}</p>
                      )}
                    </div>
                  </div>
                </InfoWindowF>
              )}
            </MarkerF>
          ))}

          {/* Restaurant markers (red) — staggered DROP */}
          {restaurantMarkers.slice(0, revealedRestCount).map((r, i) => (
            <MarkerF
              key={`rest-${i}-${r.name}`}
              position={{ lat: r.lat, lng: r.lng }}
              animation={google.maps.Animation.DROP}
              label={{
                text: String(i + 1),
                color: "white",
                fontWeight: "bold",
                fontSize: "11px",
              }}
              icon={{
                path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
                fillColor: "#EF4444",
                fillOpacity: 1,
                strokeColor: "#B91C1C",
                strokeWeight: 2,
                scale: 1.8,
                anchor: new google.maps.Point(12, 22),
                labelOrigin: new google.maps.Point(12, 9),
              }}
              onClick={() => setSelectedMarker({ type: "restaurant", index: i })}
            >
              {selectedMarker?.type === "restaurant" && selectedMarker.index === i && (
                <InfoWindowF
                  position={{ lat: r.lat, lng: r.lng }}
                  onCloseClick={() => setSelectedMarker(null)}
                >
                  <div className="p-1 min-w-[200px] max-w-[280px]">
                    <p className="font-bold text-sm text-gray-900">{r.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {r.rating && (
                        <span className="text-xs">
                          <span className="text-amber-500">★</span> {r.rating}
                          {r.total_ratings && <span className="text-gray-400"> ({r.total_ratings})</span>}
                        </span>
                      )}
                      <PriceLevel level={r.price_level} />
                    </div>
                    {r.address && (
                      <p className="text-xs text-gray-500 mt-1">📍 {r.address}</p>
                    )}

                    {/* Drive times from friends */}
                    {Object.keys(driveTimes).length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase">Drive Times</p>
                        <div className="mt-1 space-y-0.5">
                          {Object.entries(driveTimes).map(([friend, times]) => {
                            const time = times[r.name];
                            if (!time) return null;
                            return (
                              <div key={friend} className="flex justify-between text-xs">
                                <span className="text-gray-600">🚗 {friend}</span>
                                <span className="font-medium text-gray-800">{time}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Google Maps link */}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}&query_place_id=${r.lat},${r.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-xs text-blue-600 hover:underline"
                    >
                      View on Google Maps →
                    </a>
                  </div>
                </InfoWindowF>
              )}
            </MarkerF>
          ))}
        </GoogleMap>
      </div>

      {/* Legend bar */}
      <div className="p-2.5 bg-white border-t border-gray-100 shrink-0">
        <div className="flex flex-wrap gap-1.5">
          {userLocation && (
            <span
              className="inline-flex items-center gap-1 text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded cursor-pointer hover:bg-blue-100"
              onClick={() => setSelectedMarker({ type: "me", index: 0 })}
            >
              <span className="w-3.5 h-3.5 rounded-full bg-blue-500 text-white text-[9px] flex items-center justify-center font-bold">
                ★
              </span>
              Me
            </span>
          )}
          {selectedData.slice(0, revealedFriendCount).map((f, i) => (
            <span
              key={f.name}
              className="inline-flex items-center gap-1 text-[11px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded cursor-pointer hover:bg-teal-100 animate-fade-in"
              onClick={() => setSelectedMarker({ type: "friend", index: i })}
            >
              <span className="w-3.5 h-3.5 rounded-full bg-teal-500 text-white text-[9px] flex items-center justify-center font-bold">
                {String.fromCharCode(65 + i)}
              </span>
              {f.name}
            </span>
          ))}
          {restaurantMarkers.slice(0, revealedRestCount).map((r, i) => (
            <span
              key={`${i}-${r.name}`}
              className="inline-flex items-center gap-1 text-[11px] text-red-700 bg-red-50 px-2 py-0.5 rounded cursor-pointer hover:bg-red-100 animate-fade-in"
              onClick={() => setSelectedMarker({ type: "restaurant", index: i })}
            >
              <span className="w-3.5 h-3.5 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                {i + 1}
              </span>
              <span className="truncate max-w-[100px]">{r.name}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
