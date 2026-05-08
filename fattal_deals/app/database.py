import sqlite3
from pathlib import Path

DB_PATH = Path("/data/fattal_deals.db")


def get_conn():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hotel_id TEXT NOT NULL,
            hotel_name TEXT,
            check_in TEXT NOT NULL,
            check_out TEXT NOT NULL,
            nights INTEGER NOT NULL,
            price REAL,
            club_price REAL,
            price_per_night REAL,
            checked_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.commit()
    conn.close()


def save_deal(hotel_id, hotel_name, check_in, check_out, nights, price, club_price):
    price_per_night = round(price / nights, 2) if nights else None
    conn = get_conn()
    conn.execute(
        """INSERT INTO deals
           (hotel_id, hotel_name, check_in, check_out, nights, price, club_price, price_per_night)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (hotel_id, hotel_name, check_in, check_out, nights, price, club_price, price_per_night),
    )
    conn.commit()
    conn.close()


def get_deals(limit=500):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM deals ORDER BY checked_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
