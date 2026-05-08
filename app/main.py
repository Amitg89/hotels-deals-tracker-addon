import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import uvicorn
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from database import get_deals, get_price_history, init_db, save_price
from notifier import get_ha_notify_services, send_ha_notification
from scraper import CITIES, get_hotels_by_city, search_prices

DATA_DIR = Path("/data")
CONFIG_FILE = DATA_DIR / "config.json"

DEFAULT_CONFIG = {
    "city": "eilat",
    "hotels": [],
    "date_from": "",
    "date_to": "",
    "nights": [2, 3],
    "adults": 2,
    "children": 0,
    "price_threshold": 5000,
    "notify_device": "",
    "interval_hours": 12,
    "active": False,
    "last_run": None,
    "next_run": None,
}

scheduler = AsyncIOScheduler(timezone="Asia/Jerusalem")


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return DEFAULT_CONFIG.copy()


def save_config(config: dict):
    DATA_DIR.mkdir(exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2, ensure_ascii=False))


async def run_price_check():
    config = load_config()
    config["last_run"] = datetime.now().isoformat()
    save_config(config)

    hotel_ids = config.get("hotels", [])
    date_from_str = config.get("date_from", "")
    date_to_str = config.get("date_to", "")
    nights_list = config.get("nights", [2, 3])

    if not hotel_ids or not date_from_str or not date_to_str:
        return

    date_from = date.fromisoformat(date_from_str)
    date_to = date.fromisoformat(date_to_str)
    threshold = config.get("price_threshold", 5000)
    deals_found = []

    current_date = date_from
    while current_date <= date_to:
        for nights in nights_list:
            try:
                results = await search_prices(
                    hotel_ids=hotel_ids,
                    from_date=current_date.isoformat(),
                    nights=nights,
                    adults=config.get("adults", 2),
                    children=config.get("children", 0),
                )
                for hotel in results:
                    if not hotel.get("available"):
                        continue
                    save_price(
                        hotel_id=hotel["hotelID"],
                        hotel_name=hotel.get("hotelName", hotel["hotelID"]),
                        check_in=hotel["fromDate"],
                        check_out=hotel["toDate"],
                        nights=nights,
                        price=hotel["minTotalPrice"],
                        club_price=hotel["clubMinTotalPrice"],
                        available=True,
                    )
                    if hotel["minTotalPrice"] <= threshold:
                        deals_found.append(hotel)
            except Exception as e:
                print(f"Error checking {current_date} {nights}n: {e}")

        current_date += timedelta(days=1)
        await asyncio.sleep(0.3)  # gentle rate limiting

    if deals_found and config.get("notify_device"):
        lines = [
            f"• {d['hotelName']}: ₪{d['minTotalPrice']:,.0f} ({d['fromDate']}, {nights}n)"
            for d in deals_found[:5]
        ]
        await send_ha_notification(
            device=config["notify_device"],
            title=f"🏨 {len(deals_found)} Fattal deals found!",
            message="\n".join(lines),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    config = load_config()
    if config.get("active"):
        if not scheduler.running:
            scheduler.start()
        scheduler.add_job(
            run_price_check,
            IntervalTrigger(hours=config.get("interval_hours", 12)),
            id="price_check",
            replace_existing=True,
        )
    yield
    if scheduler.running:
        scheduler.shutdown()


app = FastAPI(title="Fattal Deals", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/status")
async def get_status():
    config = load_config()
    job = scheduler.get_job("price_check") if scheduler.running else None
    return {
        "active": config.get("active", False),
        "last_run": config.get("last_run"),
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
    }


@app.get("/api/config")
async def get_config():
    return load_config()


@app.post("/api/config")
async def update_config(request: Request):
    data = await request.json()
    config = load_config()
    config.update(data)
    save_config(config)
    return {"status": "ok"}


@app.get("/api/cities")
async def list_cities():
    return [{"slug": slug, "name": info["name"]} for slug, info in CITIES.items()]


@app.get("/api/hotels")
async def list_hotels(city: str = "eilat"):
    return await get_hotels_by_city(city)


@app.get("/api/notify-devices")
async def notify_devices():
    return await get_ha_notify_services()


@app.post("/api/jobs/start")
async def start_job(request: Request):
    data = await request.json()
    config = load_config()
    config.update(data)
    config["active"] = True
    save_config(config)

    if not scheduler.running:
        scheduler.start()
    scheduler.add_job(
        run_price_check,
        IntervalTrigger(hours=config.get("interval_hours", 12)),
        id="price_check",
        replace_existing=True,
    )
    return {"status": "started"}


@app.post("/api/jobs/stop")
async def stop_job():
    config = load_config()
    config["active"] = False
    save_config(config)
    if scheduler.get_job("price_check"):
        scheduler.remove_job("price_check")
    return {"status": "stopped"}


@app.post("/api/jobs/run-now")
async def run_now():
    asyncio.create_task(run_price_check())
    return {"status": "triggered"}


@app.get("/api/history")
async def price_history(limit: int = 200):
    return get_price_history(limit)


@app.get("/api/deals")
async def list_deals(threshold: Optional[float] = None):
    config = load_config()
    t = threshold or config.get("price_threshold", 5000)
    return get_deals(t)


app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8099, log_level="info")
