"""Read-only MangoTCG runtime recovery diagnosis for the production SSH account."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen


def database_summary(path: Path) -> tuple[str | None, bool] | None:
    try:
        connection = sqlite3.connect(f"file:{quote(str(path))}?mode=ro", uri=True)
        connection.execute("PRAGMA query_only = ON")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        if "orders" not in tables:
            return None
        latest_order = connection.execute("SELECT MAX(created_at) FROM orders").fetchone()[0]
        has_reward_ledger = "reward_ledger" in tables
        connection.close()
        return latest_order, has_reward_ledger
    except (OSError, sqlite3.Error):
        return None


REQUIRED_ENVIRONMENT_KEYS = {
    "ADMIN_PRIMARY_ID", "ADMIN_PRIMARY_PASSWORD", "ADMIN_SECONDARY_ID", "ADMIN_SECONDARY_PASSWORD",
    "CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_REDIRECT_URI",
    "CAFE24_TOKEN_ENCRYPTION_KEY", "CAFE24_WEBHOOK_TOKEN",
}


def deleted_database_processes() -> dict[int, set[str]]:
    processes: dict[int, set[str]] = {}
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        fd_directory = process / "fd"
        try:
            for descriptor in fd_directory.iterdir():
                target = os.readlink(descriptor)
                if "cardbreak.db" in target and "(deleted)" in target:
                    processes.setdefault(int(process.name), set()).add(target)
        except OSError:
            continue
    return processes


def required_environment_key_count(pid: int) -> int:
    try:
        values = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    except OSError:
        return 0
    keys = {item.split(b"=", 1)[0].decode("utf-8", "ignore") for item in values if b"=" in item}
    return len(keys & REQUIRED_ENVIRONMENT_KEYS)


def environment_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    return values


def admin_cookie(values: dict[str, str]) -> str | None:
    admin_id = values.get("ADMIN_PRIMARY_ID", "").strip()
    password = values.get("ADMIN_PRIMARY_PASSWORD", "")
    if not admin_id or not password:
        return None
    token_input = f"{admin_id.lower()}\0{password.lower()}".encode("utf-8")
    return hashlib.sha256(token_input).hexdigest()


def running_release(app_root: Path) -> Path | None:
    try:
        processes = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    current = [entry for entry in processes if entry.get("name") == "obs-overlay"]
    if len(current) != 1:
        return None
    cwd = current[0].get("pm2_env", {}).get("pm_cwd")
    if not isinstance(cwd, str):
        return None
    runtime = Path(cwd).resolve()
    if not str(runtime).startswith(str(app_root).rstrip("/") + "/mangotcg-release-"):
        return None
    return runtime


def request_admin_json(path: str, cookie: str) -> dict:
    request = Request(
        f"http://127.0.0.1:3001{path}",
        headers={"Cookie": f"admin_auth={cookie}"},
    )
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise OSError(f"admin_endpoint_http_{response.status}")
        return json.loads(response.read().decode("utf-8"))


def parse_order_time(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def paid_order_metrics(orders: list[dict], start: datetime, end: datetime) -> dict[str, int]:
    total = card_count = bank_count = 0
    bank_methods = {"cash", "deposit", "escrow_cash"}
    for order in orders:
        try:
            created_at = parse_order_time(str(order.get("created_at", "")))
        except ValueError:
            continue
        if not (start <= created_at < end) or order.get("status") == "cancelled" or not order.get("paid_at"):
            continue
        total += int(order.get("actual_amount") or 0)
        methods = {part.strip().lower() for part in str(order.get("payment_method") or "").split(",")}
        if "card" in methods:
            card_count += 1
        elif methods & bank_methods:
            bank_count += 1
    return {"amount": total, "card_count": card_count, "bank_count": bank_count}


def monthly_reward_total(summary: dict, orders: list[dict], start: datetime, end: datetime) -> int:
    total = 0
    for order in orders:
        try:
            created_at = parse_order_time(str(order.get("created_at", "")))
        except ValueError:
            continue
        if not (start <= created_at < end):
            continue
        order_id = order.get("external_order_id")
        reward = summary.get(str(order_id), {}) if order_id else {}
        issue = reward.get("issue")
        recover = reward.get("recover")
        if issue and issue.get("status") == "succeeded":
            total += int(issue.get("amount") or 0)
        if recover and recover.get("status") == "succeeded":
            total -= int(recover.get("amount") or 0)
    return total


def dashboard_api_comparison(runtime: Path) -> None:
    cookie = admin_cookie(environment_values(runtime / ".env.local"))
    if not cookie:
        print("production_dashboard_comparison=unavailable:admin_credentials")
        return
    try:
        dashboard = request_admin_json("/api/order-history?range=dashboard", cookie)
        now_kst = datetime.now(timezone.utc) + timedelta(hours=9)
        history = request_admin_json(
            f"/api/order-history?year={now_kst.year}&month={now_kst.month}", cookie
        )
        month_start = datetime(now_kst.year, now_kst.month, 1, tzinfo=timezone(timedelta(hours=9))).astimezone(timezone.utc)
        if now_kst.month == 12:
            month_end = datetime(now_kst.year + 1, 1, 1, tzinfo=timezone(timedelta(hours=9))).astimezone(timezone.utc)
        else:
            month_end = datetime(now_kst.year, now_kst.month + 1, 1, tzinfo=timezone(timedelta(hours=9))).astimezone(timezone.utc)
        dashboard_orders = dashboard.get("orders", [])
        history_orders = history.get("orders", [])
        dashboard_metrics = paid_order_metrics(dashboard_orders, month_start, month_end)
        history_metrics = paid_order_metrics(history_orders, month_start, month_end)
        dashboard_reward = sum(
            int(entry.get("amount") or 0)
            for entry in dashboard.get("rewardEntries", [])
            if month_start <= parse_order_time(str(entry.get("order_created_at", ""))) < month_end
        )
        history_reward = monthly_reward_total(history.get("rewardSummaries", {}), history_orders, month_start, month_end)
        report = {
            "month": f"{now_kst.year}-{now_kst.month:02d}",
            "dashboard_sync_error": bool(dashboard.get("syncError")),
            "history_sync_error": bool(history.get("syncError")),
            "dashboard_metrics": dashboard_metrics,
            "history_metrics": history_metrics,
            "dashboard_reward_net": dashboard_reward,
            "history_reward_net": history_reward,
            "orders_match": dashboard_metrics == history_metrics,
            "rewards_match": dashboard_reward == history_reward,
        }
        print("production_dashboard_comparison=" + json.dumps(report, separators=(",", ":")))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"production_dashboard_comparison=unavailable:{type(error).__name__}")


def main() -> int:
    if len(sys.argv) != 2:
        return 2

    app_root = Path(sys.argv[1]).resolve()
    home = Path.home()
    database_paths: list[Path] = []
    environment_paths: list[Path] = []
    for root, directories, files in os.walk(home):
        relative_depth = len(Path(root).relative_to(home).parts)
        if relative_depth >= 5:
            directories.clear()
        if "cardbreak.db" in files:
            database_paths.append(Path(root) / "cardbreak.db")
        if ".env.local" in files:
            environment_paths.append(Path(root) / ".env.local")

    valid: list[tuple[Path, str | None, bool, bool]] = []
    for database in database_paths:
        summary = database_summary(database)
        if summary is None:
            continue
        latest_order, has_reward_ledger = summary
        paired_environment = (database.parent.parent / ".env.local").is_file()
        valid.append((database, latest_order, has_reward_ledger, paired_environment))

    paired = [row for row in valid if row[3]]
    newest = max((row[1] for row in paired if row[1]), default=None)
    newest_count = sum(1 for row in paired if row[1] == newest) if newest else 0
    active_database = next((row[0] for row in paired if row[1] == newest), None)

    deleted_processes = deleted_database_processes()
    recoverable_processes = sum(
        1 for pid, targets in deleted_processes.items()
        if any(target.endswith("cardbreak.db (deleted)") for target in targets)
        and required_environment_key_count(pid) == len(REQUIRED_ENVIRONMENT_KEYS)
    )

    print("recovery_diagnostic=complete")
    print(f"runtime_database_present={str((app_root / 'data' / 'cardbreak.db').is_file()).lower()}")
    print(f"runtime_environment_present={str((app_root / '.env.local').is_file()).lower()}")
    print(f"deleted_database_handles={sum(len(targets) for targets in deleted_processes.values())}")
    print(f"deleted_database_processes={len(deleted_processes)}")
    print(f"recoverable_runtime_processes={recoverable_processes}")
    print(f"database_candidates={len(database_paths)}")
    print(f"environment_candidates={len(environment_paths)}")
    print(f"mangotcg_database_candidates={len(valid)}")
    print(f"paired_runtime_candidates={len(paired)}")
    print(f"newest_order_at={newest or 'none'}")
    print(f"newest_order_candidate_count={newest_count}")
    print(f"newest_pair_has_reward_ledger={str(any(row[1] == newest and row[2] for row in paired)).lower()}")
    if active_database:
        print("production_order_audit_begin")
        try:
            connection = sqlite3.connect(f"file:{quote(str(active_database))}?mode=ro", uri=True)
            connection.execute("PRAGMA query_only = ON")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            orders = connection.execute(
                "SELECT external_order_id, created_at, paid_at, status, actual_amount, payment_method "
                "FROM orders WHERE source = 'cafe24' AND external_order_id IS NOT NULL "
                "ORDER BY created_at DESC"
            ).fetchall()
            print(f"production_cafe24_order_count={len(orders)}")
            for order_id, created_at, paid_at, status, amount, payment_method in orders:
                reward_summary = "none"
                if "reward_ledger" in tables:
                    totals = connection.execute(
                        "SELECT action, SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END), "
                        "SUM(amount), COUNT(*) FROM reward_ledger WHERE external_order_id = ? GROUP BY action",
                        (order_id,),
                    ).fetchall()
                    reward_summary = ",".join(
                        f"{action}:{succeeded}/{total}({count})" for action, succeeded, total, count in totals
                    ) or "none"
                print(
                    f"production_order={order_id}|{created_at}|{paid_at or '-'}|{status}|"
                    f"{amount if amount is not None else '-'}|{payment_method or '-'}|reward={reward_summary}"
                )
            hidden = []
            if "hidden_order_history" in tables:
                hidden = [row[0] for row in connection.execute(
                    "SELECT external_order_id FROM hidden_order_history ORDER BY external_order_id"
                )]
            print(f"production_hidden_order_ids={','.join(hidden) if hidden else 'none'}")
            connection.close()
        except (OSError, sqlite3.Error) as error:
            print(f"production_order_audit=failed:{type(error).__name__}")
            return 1
        print("production_order_audit_end")
    runtime = running_release(app_root)
    if runtime:
        dashboard_api_comparison(runtime)
    else:
        print("production_dashboard_comparison=unavailable:active_runtime")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
