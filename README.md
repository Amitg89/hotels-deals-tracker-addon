# Fattal Deals Tracker — HA Add-on

Tracks hotel prices on Fattal.co.il every 12h and sends push notifications when deals are found.

## Installation on HassOS

### Option A — Via Samba / File Editor (easiest)

1. Install the **Samba share** add-on (or **VS Code** / **File Editor** add-on) in HA
2. Copy the entire `fattal-deals/` folder into `/addons/` on your HA filesystem
   - Via Samba: connect to `\\homeassistant\addons` and paste the folder
3. In HA go to **Settings → Add-ons → Add-on Store**
4. Click the **⋮ menu → Check for updates** (top right)
5. You should now see **"Fattal Deals Tracker"** under **Local add-ons**
6. Click it → **Install** → **Start**
7. The panel appears in your HA sidebar as **"Fattal Deals"**

### Option B — Via SSH

```bash
# SSH into HA
ssh root@homeassistant.local

# Create the add-on directory
mkdir -p /addons/fattal_deals

# Copy files (from your Mac, in another terminal):
scp -r /Users/amitglam/Downloads/fattal-deals/* root@homeassistant.local:/addons/fattal_deals/
```

Then follow steps 3–7 from Option A.

## Usage

1. Open **Fattal Deals** in the HA sidebar
2. Select city & hotels to track
3. Set a check-in date range and stay duration (2 or 3 nights)
4. Set a price threshold — you'll be notified when any price is at or below this
5. Select your HA mobile app device from the dropdown
6. Click **Start** — the tracker runs on your chosen interval
7. Use **Run Now** to trigger an immediate check

## Notes

- Price history is stored in `/data/fattal_deals.db` (persists across restarts)
- The job survives HA restarts — if it was active when HA stopped, it resumes automatically
- Deals shown in green in the history table
- MariaDB is not needed — uses lightweight SQLite
