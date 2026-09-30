"""Read-only MangoTCG runtime recovery diagnosis for the production SSH account."""
from __future__ import annotations

import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote


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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
