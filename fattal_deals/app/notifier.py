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
            # HA returns [{domain, services: {service_name: {...}}}]
            result = []
            for domain_obj in resp.json():
                if domain_obj.get("domain") == "notify":
                    for svc_name in domain_obj.get("services", {}).keys():
                        if "mobile_app" in svc_name:
                            full = f"notify.{svc_name}"
                            label = svc_name.replace("mobile_app_", "").replace("_", " ").title()
                            result.append({"id": full, "name": label})
            return result
    except Exception as e:
        return [{"id": "__error__", "name": f"Error: {e}"}]


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
