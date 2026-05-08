import os
import httpx

SUPERVISOR_URL = "http://supervisor"


def _token():
    return os.environ.get("SUPERVISOR_TOKEN", "")


async def get_ha_notify_services():
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{SUPERVISOR_URL}/core/api/services",
                headers={"Authorization": f"Bearer {_token()}"},
            )
            if resp.status_code != 200:
                return []
            return [
                {"id": f"{s['domain']}.{s['service']}", "name": f"{s['domain']}.{s['service']}"}
                for s in resp.json()
                if s.get("domain") == "notify" and "mobile_app" in s.get("service", "")
            ]
    except Exception:
        return []


async def send_ha_notification(device: str, title: str, message: str):
    service = device if "." in device else f"notify.{device}"
    domain, service_name = service.split(".", 1)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{SUPERVISOR_URL}/core/api/services/{domain}/{service_name}",
                headers={"Authorization": f"Bearer {_token()}"},
                json={
                    "title": title,
                    "message": message,
                    "data": {"url": "https://www.fattal.co.il", "push": {"sound": "default"}},
                },
            )
            return resp.status_code == 200
    except Exception:
        return False
