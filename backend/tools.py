"""
Tool implementations for the Group Dining Planner Agent.
- get_friends_info: local JSON DB
- search_restaurants: Google Places API (Text Search)
- calculate_drive_times: Google Distance Matrix API
- validate_restaurants: filter candidates by allergies/dislikes/constraints
- rank_and_score: weighted scoring of surviving candidates
- get_restaurant_details: Google Places Details API for deep info
"""

from __future__ import annotations

import json
import os
import re
import statistics
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
YELP_API_KEY = os.getenv("YELP_API_KEY", "")

# ─── User location store (set per-request by the agent) ───
_user_location: dict = {}  # {"lat": float, "lng": float, "address": str}


def set_user_location(loc: dict):
    """Called by the agent before each run to store the user's location."""
    global _user_location
    _user_location = loc or {}


# Load friends database
_friends_path = Path(__file__).parent / "data" / "friends.json"
with open(_friends_path, "r", encoding="utf-8") as f:
    FRIENDS_DB = json.load(f)


# ---------------------------------------------------------------------------
# Tool 1: Friends DB lookup
# ---------------------------------------------------------------------------
async def get_friends_info(friend_names: list[str]) -> dict:
    """Return location and preference info for the requested friends."""
    results = {}
    all_names = {fr["name"].lower(): fr for fr in FRIENDS_DB["friends"]}
    for name in friend_names:
        key = name.strip().lower()
        if key in all_names:
            results[all_names[key]["name"]] = all_names[key]
        else:
            results[name] = {"error": f"Friend '{name}' not found in database"}
    return results


# ---------------------------------------------------------------------------
# Tool 2: Google Places Text Search
# ---------------------------------------------------------------------------
async def search_restaurants(
    query: str,
    latitude: float,
    longitude: float,
    radius: int = 5000,
    min_price: int = 0,
    max_price: int = 4,
    open_now: bool = True,
) -> list[dict]:
    """Search restaurants via Google Places Text Search API."""
    # Auto-blend user location into center so results aren't biased toward friends only
    if _user_location and _user_location.get("lat"):
        latitude = (latitude + _user_location["lat"]) / 2
        longitude = (longitude + _user_location["lng"]) / 2
        # Increase radius to cover the wider area
        radius = max(radius, 8000)

    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params: dict = {
        "query": query,
        "location": f"{latitude},{longitude}",
        "radius": radius,
        "type": "restaurant",
        "key": GOOGLE_MAPS_API_KEY,
    }
    if open_now:
        params["opennow"] = ""  # presence of param is enough

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        data = resp.json()

    if data.get("status") not in ("OK", "ZERO_RESULTS"):
        return [{"error": f"Google Places API error: {data.get('status')} - {data.get('error_message', '')}"}]

    restaurants: list[dict] = []
    for place in data.get("results", [])[:15]:
        price_level = place.get("price_level")
        # Filter by price if available
        if price_level is not None and (price_level < min_price or price_level > max_price):
            continue
        restaurants.append({
            "name": place["name"],
            "place_id": place["place_id"],
            "address": place.get("formatted_address", ""),
            "location": place["geometry"]["location"],
            "rating": place.get("rating", 0),
            "price_level": price_level,
            "total_ratings": place.get("user_ratings_total", 0),
            "open_now": place.get("opening_hours", {}).get("open_now"),
            "types": place.get("types", []),
        })

    return restaurants


# ---------------------------------------------------------------------------
# Tool 3: Google Distance Matrix
# ---------------------------------------------------------------------------
async def calculate_drive_times(
    origins: list[dict],       # [{"name": "Alice", "lat": 37.77, "lng": -122.41}, ...]
    destinations: list[dict],  # [{"name": "Sushi Place", "lat": 37.56, "lng": -122.01}, ...]
) -> list[dict]:
    """Calculate driving duration from each origin to each destination."""
    # Auto-inject or replace "Me" with the real user location
    if _user_location and _user_location.get("lat"):
        # Remove any existing "Me"/"User" entry (GPT may pass wrong coords)
        origins = [o for o in origins if o.get("name", "").lower() not in ("me", "user")]
        # Add with correct coordinates
        origins = list(origins) + [{
            "name": "Me",
            "lat": _user_location["lat"],
            "lng": _user_location["lng"],
        }]

    origin_str = "|".join(f"{o['lat']},{o['lng']}" for o in origins)
    dest_str = "|".join(f"{d['lat']},{d['lng']}" for d in destinations)

    url = "https://maps.googleapis.com/maps/api/distancematrix/json"
    params = {
        "origins": origin_str,
        "destinations": dest_str,
        "mode": "driving",
        "key": GOOGLE_MAPS_API_KEY,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        data = resp.json()

    if data.get("status") != "OK":
        return [{"error": f"Distance Matrix API error: {data.get('status')} - {data.get('error_message', '')}"}]

    results: list[dict] = []
    for i, origin in enumerate(origins):
        for j, dest in enumerate(destinations):
            element = data["rows"][i]["elements"][j]
            if element["status"] == "OK":
                results.append({
                    "friend": origin["name"],
                    "restaurant": dest["name"],
                    "duration_text": element["duration"]["text"],
                    "duration_seconds": element["duration"]["value"],
                    "distance_text": element["distance"]["text"],
                })
            else:
                results.append({
                    "friend": origin["name"],
                    "restaurant": dest["name"],
                    "duration_text": "N/A",
                    "duration_seconds": 99999,
                    "distance_text": "N/A",
                })

    return results


# ---------------------------------------------------------------------------
# Tool 4: Validate / Filter Restaurants
# ---------------------------------------------------------------------------
async def validate_restaurants(
    restaurants: list[dict],
    allergies: list[str],
    dislikes: list[str],
    blacklist: list[str],
    max_drive_seconds: int = 0,
    drive_times: list[dict] = None,
) -> dict:
    """Filter restaurant candidates against group constraints.
    Returns kept and removed lists with reasons."""
    kept = []
    removed = []
    allergy_set = {a.lower() for a in allergies}
    dislike_set = {d.lower() for d in dislikes}
    blacklist_set = {b.lower() for b in blacklist}
    drive_times = drive_times or []

    # Build drive-time lookup: restaurant_name -> max_seconds
    drive_lookup: dict[str, int] = {}
    for dt in drive_times:
        rname = dt.get("restaurant", "")
        secs = dt.get("duration_seconds", 0)
        drive_lookup[rname] = max(drive_lookup.get(rname, 0), secs)

    for r in restaurants:
        reasons = []
        name_lower = r.get("name", "").lower()

        # Blacklist check
        if any(bl in name_lower for bl in blacklist_set):
            reasons.append(f"Blacklisted: matches '{name_lower}'")

        # Allergy / dislike check (match against restaurant name or cuisine type)
        name_words = set(name_lower.split())
        for allergen in allergy_set:
            if allergen in name_lower:
                reasons.append(f"Allergy conflict: '{allergen}' found in name")
        for dis in dislike_set:
            if dis in name_lower:
                reasons.append(f"Dislike conflict: '{dis}' found in name")

        # Max drive time check
        if max_drive_seconds > 0 and r.get("name") in drive_lookup:
            max_actual = drive_lookup[r["name"]]
            if max_actual > max_drive_seconds:
                mins = max_actual // 60
                limit = max_drive_seconds // 60
                reasons.append(f"Drive time {mins}min exceeds limit {limit}min")

        if reasons:
            removed.append({"restaurant": r["name"], "reasons": reasons})
        else:
            kept.append(r)

    return {
        "kept_count": len(kept),
        "removed_count": len(removed),
        "kept": kept,
        "removed": removed,
    }


# ---------------------------------------------------------------------------
# Tool 5: Rank & Score Restaurants
# ---------------------------------------------------------------------------
async def rank_and_score(
    candidates: list[dict],
    drive_times: list[dict],
    max_rating: float = 5.0,
    budget_level: int = 2,
    preferred_cuisines: list[str] = None,
) -> list[dict]:
    """Score and rank restaurant candidates using weighted criteria.
    Weights: Drive time 35%, Rating 30%, Fairness 20%, Price fit 15%.
    Returns sorted list with score breakdown."""
    preferred_cuisines = preferred_cuisines or []

    # Build drive-time stats per restaurant
    drive_stats: dict[str, dict] = {}
    for dt in drive_times:
        rname = dt.get("restaurant", "")
        secs = dt.get("duration_seconds", 0)
        if rname not in drive_stats:
            drive_stats[rname] = {"times": [], "max": 0, "min": 99999}
        drive_stats[rname]["times"].append(secs)
        drive_stats[rname]["max"] = max(drive_stats[rname]["max"], secs)
        drive_stats[rname]["min"] = min(drive_stats[rname]["min"], secs)

    # Pre-compute drive-time spreads for relative fairness normalization
    spreads: dict[str, float] = {}
    for r in candidates:
        name = r.get("name", "")
        stats = drive_stats.get(name, {"times": [], "max": 0, "min": 99999})
        if stats["times"]:
            spreads[name] = stats["max"] - stats["min"]
        else:
            spreads[name] = 0

    all_spreads = list(spreads.values())
    min_spread = min(all_spreads) if all_spreads else 0
    max_spread = max(all_spreads) if all_spreads else 0

    scored = []
    for r in candidates:
        name = r.get("name", "")

        # Rating score (30%) — scale to 0-10
        rating = r.get("rating", 0) or 0
        total_ratings = r.get("total_ratings", 0) or 0
        rating_score = (rating / max_rating) * 10
        if total_ratings >= 500:
            rating_score = min(10, rating_score * 1.1)
        elif total_ratings >= 200:
            rating_score = min(10, rating_score * 1.05)
        elif total_ratings < 50:
            rating_score *= 0.75

        # Drive time score (35%) — shorter avg commute = higher score
        stats = drive_stats.get(name, {"times": [], "max": 0, "min": 0})
        if stats["times"]:
            avg_time = sum(stats["times"]) / len(stats["times"])
            drive_score = max(0, 10 - (avg_time / 240))
        else:
            drive_score = 5.0

        # Fairness score (20%) — normalized across candidates so the most
        # balanced restaurant scores highest and there's always differentiation.
        # Range: [2, 9] — never 0, never a perfect 10.
        spread = spreads.get(name, 0)
        if max_spread == min_spread:
            fairness_score = 7.0
        else:
            t = (spread - min_spread) / (max_spread - min_spread)
            fairness_score = 9.0 - t * 7.0  # best spread → 9, worst → 2

        # Price fit score (15%) — closer to budget_level = higher
        price = r.get("price_level")
        if price is not None:
            diff = abs(price - budget_level)
            price_score = max(0, 10 - diff * 3)
        else:
            price_score = 6.0

        # Weighted total
        total = (
            drive_score * 0.35
            + rating_score * 0.30
            + fairness_score * 0.20
            + price_score * 0.15
        )

        scored.append({
            "name": name,
            "total_score": round(total, 2),
            "breakdown": {
                "drive_score": round(drive_score, 2),
                "rating_score": round(rating_score, 2),
                "fairness_score": round(fairness_score, 2),
                "price_score": round(price_score, 2),
            },
            "rating": rating,
            "total_ratings": total_ratings,
            "price_level": price,
            "address": r.get("address", ""),
            "place_id": r.get("place_id", ""),
            "location": r.get("location"),
            "drive_stats": {
                "avg_minutes": round(sum(stats["times"]) / len(stats["times"]) / 60, 1) if stats["times"] else None,
                "max_minutes": round(stats["max"] / 60, 1) if stats["times"] else None,
                "spread_minutes": round((stats["max"] - stats["min"]) / 60, 1) if stats["times"] else None,
            },
        })

    scored.sort(key=lambda x: x["total_score"], reverse=True)
    return scored


# ---------------------------------------------------------------------------
# Tool 6: Google Places Details
# ---------------------------------------------------------------------------
async def get_restaurant_details(place_ids: list[str]) -> list[dict]:
    """Fetch detailed info for restaurants via Google Places Details API.
    Returns reviews, phone, hours, website, and photo references."""
    results = []
    fields = "name,formatted_phone_number,website,url,opening_hours,reviews,photos,editorial_summary"

    async with httpx.AsyncClient(timeout=15) as client:
        for pid in place_ids[:5]:  # limit to 5 to control API costs
            url = "https://maps.googleapis.com/maps/api/place/details/json"
            params = {
                "place_id": pid,
                "fields": fields,
                "key": GOOGLE_MAPS_API_KEY,
            }
            resp = await client.get(url, params=params)
            data = resp.json()

            if data.get("status") != "OK":
                results.append({"place_id": pid, "error": data.get("status")})
                continue

            place = data["result"]
            # Extract top 3 reviews
            reviews = []
            for rev in place.get("reviews", [])[:3]:
                reviews.append({
                    "author": rev.get("author_name", ""),
                    "rating": rev.get("rating"),
                    "text": rev.get("text", "")[:200],
                    "time": rev.get("relative_time_description", ""),
                })

            results.append({
                "place_id": pid,
                "name": place.get("name", ""),
                "phone": place.get("formatted_phone_number", ""),
                "website": place.get("website", ""),
                "google_maps_url": place.get("url", ""),
                "hours": place.get("opening_hours", {}).get("weekday_text", []),
                "summary": place.get("editorial_summary", {}).get("overview", ""),
                "reviews": reviews,
                "photo_count": len(place.get("photos", [])),
            })

    return results


# ---------------------------------------------------------------------------
# Tool 7: Book a Ride (Uber / Lyft deep links)
# ---------------------------------------------------------------------------
async def book_ride(
    restaurant_name: str,
    restaurant_lat: float,
    restaurant_lng: float,
    restaurant_address: str,
    pickup_lat: float = 0,
    pickup_lng: float = 0,
    pickup_address: str = "",
) -> dict:
    """Generate an Uber ride request link with prefilled pickup and dropoff."""
    import uuid
    from urllib.parse import urlencode

    dropoff_data = json.dumps({
        "addressLine1": restaurant_name,
        "addressLine2": restaurant_address,
        "id": str(uuid.uuid4()),
        "source": "SEARCH",
        "latitude": restaurant_lat,
        "longitude": restaurant_lng,
        "provider": "uber_places",
    })

    params: dict[str, str] = {"drop[0]": dropoff_data}

    if pickup_lat and pickup_lng:
        addr_parts = pickup_address.split(", ", 1) if pickup_address else ["My Location", ""]
        pickup_data = json.dumps({
            "addressLine1": addr_parts[0],
            "addressLine2": addr_parts[1] if len(addr_parts) > 1 else "",
            "id": str(uuid.uuid4()),
            "source": "SEARCH",
            "latitude": pickup_lat,
            "longitude": pickup_lng,
            "provider": "uber_places",
        })
        params["pickup"] = pickup_data

    uber_link = "https://m.uber.com/go/product-selection?" + urlencode(params)

    return {
        "restaurant": restaurant_name,
        "address": restaurant_address,
        "uber_link": uber_link,
    }


# ---------------------------------------------------------------------------
# Tool 8: Add to Google Calendar
# ---------------------------------------------------------------------------
async def add_to_calendar(
    restaurant_name: str,
    restaurant_address: str,
    date: str = "",
    time: str = "19:00",
    duration_hours: float = 2,
    friends: list[str] = None,
    notes: str = "",
) -> dict:
    """Generate a Google Calendar link to create a dinner event."""
    from datetime import datetime, timedelta
    from urllib.parse import urlencode

    friends = friends or []

    # Parse date (default to today)
    if date:
        try:
            dt = datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")
        except ValueError:
            dt = datetime.now().replace(hour=19, minute=0, second=0)
    else:
        dt = datetime.now().replace(hour=19, minute=0, second=0)
        # If 7pm already passed today, use tomorrow
        if dt < datetime.now():
            dt += timedelta(days=1)

    end_dt = dt + timedelta(hours=duration_hours)

    # Google Calendar date format: YYYYMMDDTHHmmSS
    fmt = "%Y%m%dT%H%M%S"
    dates_str = f"{dt.strftime(fmt)}/{end_dt.strftime(fmt)}"

    title = f"Dinner at {restaurant_name}"
    details = f"Group dinner with {', '.join(friends)}." if friends else "Group dinner."
    if notes:
        details += f"\n{notes}"

    params = {
        "action": "TEMPLATE",
        "text": title,
        "dates": dates_str,
        "details": details,
        "location": f"{restaurant_name}, {restaurant_address}",
    }

    calendar_link = "https://calendar.google.com/calendar/render?" + urlencode(params)

    return {
        "restaurant": restaurant_name,
        "date": dt.strftime("%B %d, %Y"),
        "time": dt.strftime("%I:%M %p"),
        "calendar_link": calendar_link,
    }


# ---------------------------------------------------------------------------
# Tool 9: Yelp Info — reviews, menu items with prices, estimated per-person cost
# ---------------------------------------------------------------------------

# ── Yelp menu parsing helpers (module-level, synchronous) ──

def _parse_json_ld_menu(data: dict) -> list[dict]:
    """Parse a JSON-LD Menu schema object into sections with items."""
    sections = []
    for section in data.get("hasMenuSection", []):
        items = []
        for item in section.get("hasMenuItem", []):
            offers = item.get("offers", {})
            price = offers.get("price") or offers.get("lowPrice")
            try:
                price = float(price) if price else None
            except (ValueError, TypeError):
                price = None
            items.append({"name": item.get("name", ""), "price": price})
        if items:
            sections.append({"section": section.get("name", "Menu"), "items": items})
    return sections


def _parse_embedded_sections(data: list | dict) -> list[dict]:
    """Parse Yelp's internal menuSections JSON structure."""
    sections_list = data if isinstance(data, list) else [data]
    result = []
    for sec in sections_list:
        items = []
        for item in sec.get("items", sec.get("menuItems", [])):
            price = item.get("price") or item.get("displayPrice")
            if isinstance(price, str):
                price = re.sub(r"[^\d.]", "", price)
                try:
                    price = float(price) if price else None
                except ValueError:
                    price = None
            items.append({"name": item.get("title", item.get("name", "")), "price": price})
        if items:
            result.append({"section": sec.get("title", sec.get("name", "Menu")), "items": items})
    return result


def _parse_yelp_menu(html: str) -> list[dict]:
    """3-layer strategy to extract menu items with prices from Yelp menu HTML."""
    soup = BeautifulSoup(html, "html.parser")

    # Layer 1: JSON-LD <script type="application/ld+json"> with @type: Menu
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            ld = json.loads(script.string or "")
            items_list = ld if isinstance(ld, list) else [ld]
            for obj in items_list:
                if obj.get("@type") == "Menu":
                    sections = _parse_json_ld_menu(obj)
                    if sections:
                        return sections
        except (json.JSONDecodeError, AttributeError):
            continue

    # Layer 2: Embedded JSON in <script> tags containing "menuSections"
    for script in soup.find_all("script"):
        text = script.string or ""
        if "menuSections" in text:
            # Try to find the JSON blob containing menuSections
            match = re.search(r'"menuSections"\s*:\s*(\[.*?\])\s*[,}]', text, re.DOTALL)
            if match:
                try:
                    data = json.loads(match.group(1))
                    sections = _parse_embedded_sections(data)
                    if sections:
                        return sections
                except json.JSONDecodeError:
                    pass

    # Layer 3: HTML fallback — find $XX.XX price patterns and nearby text
    sections = []
    items = []
    price_pattern = re.compile(r"\$(\d+(?:\.\d{2})?)")
    # Look for elements that contain price-like text
    for el in soup.find_all(string=price_pattern):
        parent = el.find_parent()
        if parent:
            # Get the surrounding text block
            block = parent.get_text(separator=" ", strip=True)
            prices = price_pattern.findall(block)
            # Try to get the item name from a nearby heading or sibling
            name_el = parent.find_previous(["h3", "h4", "p", "span"])
            name = name_el.get_text(strip=True) if name_el else block[:60]
            # Avoid duplicate entries
            for p in prices:
                try:
                    items.append({"name": name[:80], "price": float(p)})
                except ValueError:
                    pass
    if items:
        # Deduplicate by name
        seen = set()
        deduped = []
        for item in items:
            key = item["name"].lower()
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        sections.append({"section": "Menu", "items": deduped[:30]})

    return sections


def _extract_popular_dishes(reviews: list[dict]) -> list[str]:
    """Extract dish names mentioned in review text via simple heuristics."""
    # Common dish-introducing phrases
    patterns = [
        r"(?:the|their|try the|loved the|order the|get the|had the|recommend the)\s+([A-Z][a-z]+(?:\s+[A-Za-z]+){0,3})",
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s+(?:was|were|is)\s+(?:amazing|excellent|great|delicious|fantastic|incredible|good|outstanding))",
    ]
    dish_counts: dict[str, int] = {}
    stop_words = {"the", "this", "that", "they", "their", "very", "really", "also", "just", "been", "will", "would"}
    for rev in reviews:
        text = rev.get("text", "")
        for pat in patterns:
            for match in re.finditer(pat, text):
                dish = match.group(1).strip().rstrip(".,!?")
                # Filter out non-dish phrases
                words = dish.lower().split()
                if len(words) < 1 or len(words) > 5:
                    continue
                if words[0] in stop_words:
                    continue
                dish_counts[dish] = dish_counts.get(dish, 0) + 1

    # Sort by frequency, return top dishes
    sorted_dishes = sorted(dish_counts.items(), key=lambda x: x[1], reverse=True)
    return [d[0] for d in sorted_dishes[:8]]


async def get_yelp_info(restaurants: list[dict]) -> list[dict]:
    """Fetch Yelp reviews, menu items with prices, and estimated per-person cost.

    Input: [{"name": "...", "latitude": float, "longitude": float}]
    Returns Yelp rating, reviews, menu sections, estimated per-person cost, and popular dishes.
    """
    if not YELP_API_KEY:
        return [{"error": "YELP_API_KEY not configured"}]

    headers = {"Authorization": f"Bearer {YELP_API_KEY}"}
    results = []

    async with httpx.AsyncClient(timeout=15, headers=headers) as client:
        for restaurant in restaurants[:5]:
            entry: dict = {
                "name": restaurant.get("name", ""),
                "yelp_match": False,
                "yelp_rating": None,
                "yelp_review_count": None,
                "yelp_price": None,
                "reviews": [],
                "menu_sections": [],
                "estimated_per_person": None,
                "popular_dishes": [],
                "yelp_url": None,
            }

            # Stage A: Business Search
            try:
                search_resp = await client.get(
                    "https://api.yelp.com/v3/businesses/search",
                    params={
                        "term": restaurant["name"],
                        "latitude": restaurant["latitude"],
                        "longitude": restaurant["longitude"],
                        "limit": 1,
                    },
                )
                search_data = search_resp.json()
                businesses = search_data.get("businesses", [])
                if not businesses:
                    entry["error"] = "No Yelp match found"
                    results.append(entry)
                    continue

                biz = businesses[0]
                biz_id = biz["id"]
                biz_alias = biz.get("alias", "")
                entry["yelp_match"] = True
                entry["yelp_rating"] = biz.get("rating")
                entry["yelp_review_count"] = biz.get("review_count")
                entry["yelp_price"] = biz.get("price")
                entry["yelp_url"] = biz.get("url")
            except Exception as exc:
                entry["error"] = f"Yelp search failed: {str(exc)}"
                results.append(entry)
                continue

            # Stage B: Reviews
            try:
                reviews_resp = await client.get(
                    f"https://api.yelp.com/v3/businesses/{biz_id}/reviews",
                    params={"limit": 3, "sort_by": "yelp_sort"},
                )
                reviews_data = reviews_resp.json()
                yelp_reviews = []
                for rev in reviews_data.get("reviews", [])[:3]:
                    yelp_reviews.append({
                        "author": rev.get("user", {}).get("name", ""),
                        "rating": rev.get("rating"),
                        "text": rev.get("text", "")[:300],
                        "time": rev.get("time_created", ""),
                    })
                entry["reviews"] = yelp_reviews
                entry["popular_dishes"] = _extract_popular_dishes(yelp_reviews)
            except Exception:
                pass  # Reviews are optional; continue with what we have

            # Stage C: Menu Scrape
            if biz_alias:
                try:
                    menu_resp = await client.get(
                        f"https://www.yelp.com/menu/{biz_alias}",
                        headers={
                            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            "Authorization": "",  # Override — no auth for web scrape
                        },
                        follow_redirects=True,
                    )
                    if menu_resp.status_code == 200:
                        menu_sections = _parse_yelp_menu(menu_resp.text)
                        entry["menu_sections"] = menu_sections

                        # Calculate estimated per-person cost (median of all prices)
                        all_prices = []
                        for sec in menu_sections:
                            for item in sec.get("items", []):
                                if item.get("price") is not None:
                                    all_prices.append(item["price"])
                        if all_prices:
                            entry["estimated_per_person"] = round(statistics.median(all_prices), 2)
                    else:
                        entry["menu_note"] = f"Menu page returned status {menu_resp.status_code}"
                except Exception:
                    entry["menu_note"] = "Menu scrape failed"

            results.append(entry)

    return results


# ---------------------------------------------------------------------------
# OpenAI Tool Definitions (JSON Schema for function calling)
# ---------------------------------------------------------------------------
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_friends_info",
            "description": (
                "Look up friends' locations and dining preferences from the database. "
                "Call this first so you know where everyone is and what they like/dislike."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "friend_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of friend names to look up",
                    }
                },
                "required": ["friend_names"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_restaurants",
            "description": (
                "Search for restaurants using Google Places API. "
                "Provide a descriptive query (e.g. 'Japanese restaurant', 'Italian fine dining') "
                "and a center location. Returns up to 15 matching restaurants with rating, price, and address."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query, e.g. 'Japanese restaurant', 'Korean BBQ'",
                    },
                    "latitude": {
                        "type": "number",
                        "description": "Center latitude for the search area",
                    },
                    "longitude": {
                        "type": "number",
                        "description": "Center longitude for the search area",
                    },
                    "radius": {
                        "type": "integer",
                        "description": "Search radius in meters (default 5000, max 50000)",
                        "default": 5000,
                    },
                    "min_price": {
                        "type": "integer",
                        "description": "Minimum Google price level 0-4 (0=cheapest)",
                        "default": 0,
                    },
                    "max_price": {
                        "type": "integer",
                        "description": "Maximum Google price level 0-4 (4=most expensive)",
                        "default": 4,
                    },
                    "open_now": {
                        "type": "boolean",
                        "description": "Only return restaurants that are currently open",
                        "default": True,
                    },
                },
                "required": ["query", "latitude", "longitude"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_drive_times",
            "description": (
                "Calculate driving time from multiple friends to multiple restaurants "
                "using Google Maps Distance Matrix API. Returns duration and distance for each pair."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "origins": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "lat": {"type": "number"},
                                "lng": {"type": "number"},
                            },
                            "required": ["name", "lat", "lng"],
                        },
                        "description": "Friends with their lat/lng locations",
                    },
                    "destinations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "lat": {"type": "number"},
                                "lng": {"type": "number"},
                            },
                            "required": ["name", "lat", "lng"],
                        },
                        "description": "Restaurants with their lat/lng locations",
                    },
                },
                "required": ["origins", "destinations"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_restaurants",
            "description": (
                "Filter restaurant candidates against group constraints: allergies, dislikes, "
                "blacklisted restaurants, and max drive time. Returns which restaurants pass "
                "and which are removed (with reasons). Call this AFTER getting drive times."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "restaurants": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "place_id": {"type": "string"},
                                "rating": {"type": "number"},
                                "price_level": {"type": "integer"},
                                "total_ratings": {"type": "integer"},
                                "address": {"type": "string"},
                            },
                        },
                        "description": "Restaurant candidates to validate",
                    },
                    "allergies": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Combined list of all friends' allergies",
                    },
                    "dislikes": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Combined list of all friends' dislikes",
                    },
                    "blacklist": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Restaurant names or keywords to exclude",
                    },
                    "max_drive_seconds": {
                        "type": "integer",
                        "description": "Maximum allowed drive time in seconds (0 = no limit)",
                        "default": 0,
                    },
                    "drive_times": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "restaurant": {"type": "string"},
                                "duration_seconds": {"type": "integer"},
                            },
                        },
                        "description": "Drive time results from calculate_drive_times",
                    },
                },
                "required": ["restaurants", "allergies", "dislikes", "blacklist"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rank_and_score",
            "description": (
                "Score and rank restaurant candidates using weighted criteria: "
                "Rating & reviews (35%), Drive-time fairness (25%), Price fit (20%), "
                "Cuisine & occasion match (20%). Returns a sorted list with score breakdowns. "
                "Call this AFTER validate_restaurants to rank the surviving candidates."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "candidates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "place_id": {"type": "string", "description": "Google Place ID — pass through from search results"},
                                "rating": {"type": "number"},
                                "total_ratings": {"type": "integer"},
                                "price_level": {"type": "integer"},
                                "address": {"type": "string"},
                                "location": {
                                    "type": "object",
                                    "properties": {
                                        "lat": {"type": "number"},
                                        "lng": {"type": "number"},
                                    },
                                    "description": "Lat/lng — pass through from search results",
                                },
                            },
                        },
                        "description": "Validated restaurant candidates to score. IMPORTANT: include place_id and location from the original search results.",
                    },
                    "drive_times": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "friend": {"type": "string"},
                                "restaurant": {"type": "string"},
                                "duration_seconds": {"type": "integer"},
                            },
                        },
                        "description": "Drive time data for fairness scoring",
                    },
                    "budget_level": {
                        "type": "integer",
                        "description": "Target Google price level 0-4 (e.g. 2 for moderate)",
                        "default": 2,
                    },
                    "preferred_cuisines": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Preferred cuisine keywords for bonus scoring",
                    },
                },
                "required": ["candidates", "drive_times"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_restaurant_details",
            "description": (
                "Fetch detailed information for specific restaurants via Google Places Details API. "
                "Returns reviews, phone number, website, opening hours, and editorial summary. "
                "Call this for the top-ranked restaurants to enrich your final recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "place_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Google Place IDs of restaurants to look up (max 5)",
                    },
                },
                "required": ["place_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "book_ride",
            "description": (
                "Generate an Uber ride request link with prefilled pickup and dropoff. "
                "Opens Uber's product selection page with the route ready to go. "
                "Call this when the user asks for a ride, Uber, or wants to go to a restaurant. "
                "IMPORTANT: Always pass the user's location as pickup if available in the system prompt."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "restaurant_name": {
                        "type": "string",
                        "description": "Name of the restaurant",
                    },
                    "restaurant_lat": {
                        "type": "number",
                        "description": "Restaurant latitude",
                    },
                    "restaurant_lng": {
                        "type": "number",
                        "description": "Restaurant longitude",
                    },
                    "restaurant_address": {
                        "type": "string",
                        "description": "Restaurant street address",
                    },
                    "pickup_lat": {
                        "type": "number",
                        "description": "Pickup latitude (user's current location)",
                    },
                    "pickup_lng": {
                        "type": "number",
                        "description": "Pickup longitude (user's current location)",
                    },
                },
                "required": ["restaurant_name", "restaurant_lat", "restaurant_lng", "restaurant_address"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_calendar",
            "description": (
                "Generate a Google Calendar link to create a dinner event at the chosen restaurant. "
                "The link opens Google Calendar with title, date, time, location, and attendees prefilled. "
                "Call this when the user wants to schedule, add to calendar, or set a date for the dinner."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "restaurant_name": {
                        "type": "string",
                        "description": "Name of the restaurant",
                    },
                    "restaurant_address": {
                        "type": "string",
                        "description": "Restaurant street address",
                    },
                    "date": {
                        "type": "string",
                        "description": "Dinner date in YYYY-MM-DD format (default: today or tomorrow)",
                    },
                    "time": {
                        "type": "string",
                        "description": "Dinner time in HH:MM 24h format (default: 19:00)",
                        "default": "19:00",
                    },
                    "duration_hours": {
                        "type": "number",
                        "description": "Duration in hours (default: 2)",
                        "default": 2,
                    },
                    "friends": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of friend names attending",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Additional notes for the calendar event",
                    },
                },
                "required": ["restaurant_name", "restaurant_address"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_yelp_info",
            "description": (
                "Fetch Yelp reviews, menu items with prices, and estimated per-person dinner cost "
                "for restaurants. Combines Yelp data with Google data for better dish recommendations. "
                "Call this AFTER get_restaurant_details for the top-ranked restaurants."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "restaurants": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string", "description": "Restaurant name"},
                                "latitude": {"type": "number", "description": "Restaurant latitude"},
                                "longitude": {"type": "number", "description": "Restaurant longitude"},
                            },
                            "required": ["name", "latitude", "longitude"],
                        },
                        "description": "Restaurants to look up on Yelp (max 5)",
                    },
                },
                "required": ["restaurants"],
            },
        },
    },
]

# Map function names → callables
TOOL_FUNCTIONS = {
    "get_friends_info": get_friends_info,
    "search_restaurants": search_restaurants,
    "calculate_drive_times": calculate_drive_times,
    "validate_restaurants": validate_restaurants,
    "rank_and_score": rank_and_score,
    "get_restaurant_details": get_restaurant_details,
    "book_ride": book_ride,
    "add_to_calendar": add_to_calendar,
    "get_yelp_info": get_yelp_info,
}
