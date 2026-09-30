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


def deleted_database_handles() -> int:
    count = 0
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        fd_directory = process / "fd"
        try:
            for descriptor in fd_directory.iterdir():
                target = os.readlink(descriptor)
                if "cardbreak.db" in target and "(deleted)" in target:
                    count += 1
        except OSError:
            continue
    return count


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

    print("recovery_diagnostic=complete")
    print(f"runtime_database_present={str((app_root / 'data' / 'cardbreak.db').is_file()).lower()}")
    print(f"runtime_environment_present={str((app_root / '.env.local').is_file()).lower()}")
    print(f"deleted_database_handles={deleted_database_handles()}")
    print(f"database_candidates={len(database_paths)}")
    print(f"environment_candidates={len(environment_paths)}")
    print(f"mangotcg_database_candidates={len(valid)}")
    print(f"paired_runtime_candidates={len(paired)}")
    print(f"newest_order_at={newest or 'none'}")
    print(f"newest_order_candidate_count={newest_count}")
    print(f"newest_pair_has_reward_ledger={str(any(row[1] == newest and row[2] for row in paired)).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
