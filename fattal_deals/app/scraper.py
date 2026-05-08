import re
import httpx
from typing import List, Optional

GRAPHQL_URL = "https://be-new.fattal.co.il/graphql"
CMS_URL = "https://cms.fattal.co.il/graphql"

SEARCH_QUERY = """
query Search($searchInput: SearchInput!) {
  search(searchInput: $searchInput) {
    hotelID
    fromDate
    toDate
    available
    availabilityMessage
    roomSelections {
      roomCategories {
        roomCategory
        rooms {
          planCode
          totalPrice
          clubTotalPrice
        }
      }
    }
  }
}
"""

# In-memory cache so we don't hit CMS on every API call
_cities_cache: dict = {}

HOTEL_NAMES: dict = {}  # populated from CMS at runtime

# Room category pattern that marks accessible/disabled rooms — always skip
DISABLED_CAT = re.compile(r'HandD', re.IGNORECASE)

BB_PLANS = {"B/B", "BBF"}
HB_PLANS = {"H/B", "HBF"}
AI_PLANS = {"ALL", "All Incl."}


def extract_prices(hotel: dict) -> Optional[dict]:
    """
    Parse roomSelections and return the cheapest BB, HB, and AI prices,
    ignoring disabled/accessibility room categories.

    Comparison price for threshold = cheapest HB if available, else cheapest AI.
    Returns None if the hotel has no available rooms at all.
    """
    bb_prices, hb_prices, ai_prices = [], [], []

    for selection in hotel.get("roomSelections", []):
        for cat in selection.get("roomCategories", []):
            if DISABLED_CAT.search(cat.get("roomCategory", "")):
                continue
            for room in cat.get("rooms", []):
                plan = room.get("planCode", "")
                price = room.get("totalPrice")
                if price is None or price <= 0:
                    continue
                if plan in BB_PLANS:
                    bb_prices.append(price)
                elif plan in HB_PLANS:
                    hb_prices.append(price)
                elif plan in AI_PLANS:
                    ai_prices.append(price)

    bb_min = min(bb_prices) if bb_prices else None
    hb_min = min(hb_prices) if hb_prices else None
    ai_min = min(ai_prices) if ai_prices else None

    # Nothing at all — skip
    if bb_min is None and hb_min is None and ai_min is None:
        return None

    # Threshold comparison: HB preferred, fall back to AI for pure-AI hotels
    comparison_price = hb_min if hb_min is not None else ai_min

    return {
        "bb_price": bb_min,
        "hb_price": hb_min,
        "ai_price": ai_min,
        "comparison_price": comparison_price,
    }


_CMS_QUERY = """
{
  hotels(
    filters: { pmsID: { notNull: true }, pms: { pmsId: { eq: "OPTIMA_IL" } } }
    pagination: { limit: 150 }
  ) {
    data { attributes {
      pmsID
      hotelInfo { title }
      city { data { attributes { name slug } } }
    }}
  }
}
"""


async def get_all_cities_with_hotels() -> List[dict]:
    if _cities_cache:
        return sorted(_cities_cache.values(), key=lambda c: c["name"])
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(CMS_URL, json={"query": _CMS_QUERY})
            hotels_data = resp.json().get("data", {}).get("hotels", {}).get("data", [])
    except Exception:
        return []

    cities: dict = {}
    for h in hotels_data:
        attrs = h.get("attributes", {})
        pms_id = attrs.get("pmsID")
        if not pms_id:
            continue
        title = (attrs.get("hotelInfo") or {}).get("title") or pms_id
        city_attrs = ((attrs.get("city") or {}).get("data") or {}).get("attributes") or {}
        city_slug = city_attrs.get("slug") or "other"
        city_name = city_attrs.get("name") or city_slug

        HOTEL_NAMES[pms_id] = title

        if city_slug not in cities:
            cities[city_slug] = {"slug": city_slug, "name": city_name, "hotels": []}
        cities[city_slug]["hotels"].append({"id": pms_id, "name": title})

    for city in cities.values():
        city["hotels"].sort(key=lambda h: h["name"])
        _cities_cache[city["slug"]] = city

    return sorted(cities.values(), key=lambda c: c["name"])


async def search_prices(
    hotel_ids: List[str],
    from_date: str,
    nights: int,
    adults: int = 2,
    children: int = 0,
) -> List[dict]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            GRAPHQL_URL,
            json={
                "query": SEARCH_QUERY,
                "variables": {
                    "searchInput": {
                        "hotels": [{"hotelID": h} for h in hotel_ids],
                        "rooms": [{"adults": adults, "children": children, "infants": 0}],
                        "fromDate": from_date,
                        "nights": nights,
                        "isLoggedIn": False,
                        "isClerk": False,
                        "isLocal": True,
                        "language": "he",
                        "pmsId": "OPTIMA_IL",
                        "customerIds": {"club": "192", "public": "1"},
                    }
                },
            },
        )
        data = resp.json()
        results = data.get("data", {}).get("search", []) or []
        for r in results:
            r["hotelName"] = HOTEL_NAMES.get(r["hotelID"], r["hotelID"])
        return results
