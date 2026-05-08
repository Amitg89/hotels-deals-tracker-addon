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
            bb_price REAL,
            hb_price REAL,
            ai_price REAL,
            comparison_price REAL,
            checked_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    """)
    # Migrate old schema: add missing columns if they don't exist
    existing = {row[1] for row in conn.execute("PRAGMA table_info(deals)")}
    for col, typedef in [
        ("bb_price", "REAL"),
        ("hb_price", "REAL"),
        ("ai_price", "REAL"),
        ("comparison_price", "REAL"),
    ]:
        if col not in existing:
            conn.execute(f"ALTER TABLE deals ADD COLUMN {col} {typedef}")
    # Drop old columns that no longer exist in code (price, club_price, price_per_night, available)
    # SQLite doesn't support DROP COLUMN before v3.35 so we just leave them harmlessly
    conn.commit()
    conn.close()


def save_deal(hotel_id, hotel_name, check_in, check_out, nights,
              bb_price, hb_price, ai_price, comparison_price):
    conn = get_conn()
    conn.execute(
        """INSERT INTO deals
           (hotel_id, hotel_name, check_in, check_out, nights,
            bb_price, hb_price, ai_price, comparison_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (hotel_id, hotel_name, check_in, check_out, nights,
         bb_price, hb_price, ai_price, comparison_price),
    )
    conn.commit()
    conn.close()


def get_deals(limit=500):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM deals ORDER BY checked_at DESC, comparison_price ASC LIMIT ?",
        (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
