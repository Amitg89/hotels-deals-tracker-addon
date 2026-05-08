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
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hotel_id TEXT NOT NULL,
            hotel_name TEXT,
            check_in TEXT NOT NULL,
            check_out TEXT NOT NULL,
            nights INTEGER NOT NULL,
            price REAL,
            club_price REAL,
            available INTEGER DEFAULT 1,
            checked_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    conn.commit()
    conn.close()


def save_price(hotel_id, hotel_name, check_in, check_out, nights, price, club_price, available):
    conn = get_conn()
    conn.execute(
        """INSERT INTO price_history
           (hotel_id, hotel_name, check_in, check_out, nights, price, club_price, available)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (hotel_id, hotel_name, check_in, check_out, nights, price, club_price, 1 if available else 0),
    )
    conn.commit()
    conn.close()


def get_price_history(limit=200):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM price_history ORDER BY checked_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_deals(threshold: float):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM price_history WHERE price <= ? AND available = 1 ORDER BY price ASC",
        (threshold,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
