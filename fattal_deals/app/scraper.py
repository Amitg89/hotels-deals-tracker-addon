import httpx
from typing import List

GRAPHQL_URL = "https://be-new.fattal.co.il/graphql"
CMS_URL = "https://cms.fattal.co.il/graphql"

SEARCH_QUERY = """
query Search($searchInput: SearchInput!) {
  search(searchInput: $searchInput) {
    hotelID
    fromDate
    toDate
    minTotalPrice
    minTotalBasePrice
    clubMinTotalPrice
    available
    availabilityMessage
  }
}
"""

HOTEL_NAMES = {
    "10038": "Leonardo Plaza Eilat",
    "10039": "Herods Palace Eilat",
    "10040": "U Magic Palace Eilat",
    "10042": "U Splash Resort Eilat",
    "10043": "U Coral Beach Club Eilat",
    "10044": "Leonardo Royal Resort Eilat",
    "10050": "Herods Boutique Eilat",
    "10051": "Herods Vitalis Eilat",
}

CITIES = {
    "eilat": {
        "name": "Eilat",
        "hotels": [
            {"id": "10038", "name": "Leonardo Plaza Eilat"},
            {"id": "10039", "name": "Herods Palace Eilat"},
            {"id": "10040", "name": "U Magic Palace Eilat"},
            {"id": "10042", "name": "U Splash Resort Eilat"},
            {"id": "10043", "name": "U Coral Beach Club Eilat"},
            {"id": "10044", "name": "Leonardo Royal Resort Eilat"},
            {"id": "10050", "name": "Herods Boutique Eilat"},
            {"id": "10051", "name": "Herods Vitalis Eilat"},
        ],
    }
}


async def get_hotels_by_city(city: str) -> List[dict]:
    if city in CITIES:
        return CITIES[city]["hotels"]

    # Fetch from CMS for unknown cities
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                CMS_URL,
                json={
                    "query": """
                    {
                      hotels(filters: { slug: { containsi: "%s" } }, pagination: { limit: 30 }) {
                        data { attributes { slug pmsID } }
                      }
                    }
                    """ % city
                },
            )
            data = resp.json()
            hotels_data = data.get("data", {}).get("hotels", {}).get("data", [])
            return [
                {"id": h["attributes"]["pmsID"], "name": h["attributes"]["slug"]}
                for h in hotels_data
                if h["attributes"].get("pmsID")
            ]
    except Exception:
        return []


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
