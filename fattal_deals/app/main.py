import asyncio
import json
import os
from collections import deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import uvicorn
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from database import get_deals, init_db, save_deal
from notifier import get_ha_notify_services, send_ha_notification
from scraper import CITIES, extract_prices, get_hotels_by_city, search_prices

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
    "threshold_type": "stay",
    "price_threshold": 5000,
    "notify_device": "",
    "interval_hours": 12,
    "active": False,
    "last_run": None,
}

# ── Logging ───────────────────────────────────────────────────────────────────

log_buffer: deque = deque(maxlen=500)
log_subscribers: list = []


def log(msg: str, level: str = "info"):
    entry = {
        "id": len(log_buffer),
        "time": datetime.now().strftime("%H:%M:%S"),
        "level": level,
        "msg": msg,
    }
    log_buffer.append(entry)
    print(f"[{level.upper()}] {msg}")
    for q in log_subscribers:
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            pass


# ── Config ────────────────────────────────────────────────────────────────────

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


# ── Price check ───────────────────────────────────────────────────────────────

scheduler = AsyncIOScheduler(timezone="Asia/Jerusalem")


def is_deal(price: float, nights: int, config: dict) -> bool:
    threshold = config.get("price_threshold", 5000)
    if config.get("threshold_type") == "night":
        return (price / nights) <= threshold
    return price <= threshold


async def run_price_check():
    config = load_config()
    config["last_run"] = datetime.now().isoformat()
    save_config(config)

    hotel_ids = config.get("hotels", [])
    date_from_str = config.get("date_from", "")
    date_to_str = config.get("date_to", "")
    nights_list = config.get("nights", [2, 3])

    if not hotel_ids or not date_from_str or not date_to_str:
        log("Skipping — no hotels or date range configured", "warn")
        return

    date_from = date.fromisoformat(date_from_str)
    date_to = date.fromisoformat(date_to_str)
    total_dates = (date_to - date_from).days + 1
    log(f"Starting check: {total_dates} dates × {len(nights_list)} durations × {len(hotel_ids)} hotels")

    deals_found = []
    current_date = date_from

    while current_date <= date_to:
        for nights in nights_list:
            log(f"Searching {current_date} · {nights} nights …")
            try:
                results = await search_prices(
                    hotel_ids=hotel_ids,
                    from_date=current_date.isoformat(),
                    nights=nights,
                    adults=config.get("adults", 2),
                    children=config.get("children", 0),
                )
                available = [r for r in results if r.get("available")]
                log(f"  {len(available)}/{len(results)} hotels available")

                for hotel in available:
                    name = hotel.get("hotelName", hotel["hotelID"])
                    prices = extract_prices(hotel)

                    if prices is None:
                        log(f"  · {name} — no valid rooms after filtering")
                        continue

                    cp = prices["comparison_price"]
                    if cp is None:
                        log(f"  · {name} — no HB or AI price available")
                        continue

                    ppn = round(cp / nights)
                    bb_str = f"BB ₪{prices['bb_price']:,.0f}" if prices["bb_price"] else ""
                    hb_str = f"HB ₪{prices['hb_price']:,.0f}" if prices["hb_price"] else ""
                    ai_str = f"AI ₪{prices['ai_price']:,.0f}" if prices["ai_price"] else ""
                    plan_summary = "  ".join(filter(None, [bb_str, hb_str, ai_str]))

                    if is_deal(cp, nights, config):
                        log(f"  ✓ DEAL  {name}  {plan_summary}  (₪{ppn}/night HB)", "deal")
                        save_deal(
                            hotel_id=hotel["hotelID"],
                            hotel_name=name,
                            check_in=hotel["fromDate"],
                            check_out=hotel["toDate"],
                            nights=nights,
                            bb_price=prices["bb_price"],
                            hb_price=prices["hb_price"],
                            ai_price=prices["ai_price"],
                            comparison_price=cp,
                        )
                        deals_found.append({**hotel, "nights": nights, "prices": prices})
                    else:
                        log(f"  · {name}  {plan_summary}  (₪{ppn}/night HB) — above threshold")

            except Exception as e:
                log(f"  Error: {e}", "error")

        current_date += timedelta(days=1)
        await asyncio.sleep(0.3)

    log(f"Check complete — {len(deals_found)} deal(s) saved")

    if deals_found and config.get("notify_device"):
        lines = []
        for d in deals_found[:5]:
            p = d.get("prices", {})
            price_str = f"HB ₪{p['hb_price']:,.0f}" if p.get("hb_price") else f"AI ₪{p['ai_price']:,.0f}"
            lines.append(f"• {d.get('hotelName', d['hotelID'])}: {price_str} ({d['fromDate']}, {d['nights']}n)")
        ok = await send_ha_notification(
            device=config["notify_device"],
            title=f"🏨 {len(deals_found)} Fattal deal{'s' if len(deals_found) > 1 else ''} found!",
            message="\n".join(lines),
        )
        log(f"Push notification {'sent ✓' if ok else 'FAILED ✗'}", "info" if ok else "error")


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log("Fattal Deals Tracker started")
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
        log(f"Scheduler restored — every {config.get('interval_hours', 12)}h")
    yield
    if scheduler.running:
        scheduler.shutdown()


app = FastAPI(title="Fattal Deals", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Routes ────────────────────────────────────────────────────────────────────

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
    log(f"Tracker started — every {config.get('interval_hours', 12)}h")
    return {"status": "started"}


@app.post("/api/jobs/stop")
async def stop_job():
    config = load_config()
    config["active"] = False
    save_config(config)
    if scheduler.get_job("price_check"):
        scheduler.remove_job("price_check")
    log("Tracker stopped")
    return {"status": "stopped"}


@app.post("/api/jobs/run-now")
async def run_now():
    asyncio.create_task(run_price_check())
    return {"status": "triggered"}


@app.get("/api/deals")
async def list_deals(limit: int = 500):
    return get_deals(limit)


@app.get("/api/logs")
async def get_logs():
    return list(log_buffer)


@app.get("/api/logs/stream")
async def stream_logs():
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    log_subscribers.append(queue)

    async def generate():
        for entry in list(log_buffer):
            yield f"data: {json.dumps(entry)}\n\n"
        try:
            while True:
                entry = await queue.get()
                yield f"data: {json.dumps(entry)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            try:
                log_subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


app.mount("/", StaticFiles(directory="/app/static", html=True), name="static")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8099, log_level="info")
