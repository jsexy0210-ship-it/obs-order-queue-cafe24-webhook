"""Restore the deleted MangoTCG runtime DB from still-open files without exposing data."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
from urllib.parse import quote


REQUIRED_KEYS = {
    "ADMIN_PRIMARY_ID", "ADMIN_PRIMARY_PASSWORD", "ADMIN_SECONDARY_ID", "ADMIN_SECONDARY_PASSWORD",
    "CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_REDIRECT_URI",
    "CAFE24_TOKEN_ENCRYPTION_KEY", "CAFE24_WEBHOOK_TOKEN",
}


def read_environment_keys(path: Path) -> set[str]:
    return {
        line.split("=", 1)[0]
        for line in path.read_text(encoding="utf-8").splitlines()
        if "=" in line
    }


def deleted_database_files() -> tuple[int, dict[str, Path]]:
    matches: dict[int, dict[str, Path]] = {}
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            for descriptor in (process / "fd").iterdir():
                target = os.readlink(descriptor)
                if not target.endswith(" (deleted)"):
                    continue
                if "cardbreak.db" not in target:
                    continue
                suffix = ""
                if target.endswith("cardbreak.db-wal (deleted)"):
                    suffix = "-wal"
                elif target.endswith("cardbreak.db-shm (deleted)"):
                    suffix = "-shm"
                elif target.endswith("cardbreak.db (deleted)"):
                    suffix = ""
                else:
                    continue
                matches.setdefault(int(process.name), {})[suffix] = descriptor
        except OSError:
            continue

    candidates = [(pid, files) for pid, files in matches.items() if "" in files]
    if len(candidates) != 1:
        raise RuntimeError("A unique deleted runtime database handle was not found")
    return candidates[0]


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    app_root = Path(sys.argv[1]).resolve()
    supplied_environment = Path(sys.argv[2])
    if not app_root.is_dir() or not supplied_environment.is_file():
        raise RuntimeError("Recovery inputs are unavailable")
    if not REQUIRED_KEYS.issubset(read_environment_keys(supplied_environment)):
        raise RuntimeError("Recovery environment is incomplete")
    data_path = app_root / "data"
    runtime_environment = app_root / ".env.local"
    if (data_path / "cardbreak.db").exists() or runtime_environment.exists():
        raise RuntimeError("Recovery target already exists")
    if data_path.exists():
        if any(data_path.iterdir()):
            raise RuntimeError("Recovery data directory is not empty")
        data_path.rmdir()

    pid, files = deleted_database_files()
    with tempfile.TemporaryDirectory(prefix="mangotcg-runtime-recovery-", dir=app_root) as temporary:
        staging = Path(temporary)
        for suffix, descriptor in files.items():
            shutil.copyfile(descriptor, staging / f"cardbreak.db{suffix}")
        database = staging / "cardbreak.db"
        connection = sqlite3.connect(f"file:{quote(str(database))}?mode=ro", uri=True)
        connection.execute("PRAGMA query_only = ON")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        latest_order = connection.execute("SELECT MAX(created_at) FROM orders").fetchone()[0]
        connection.close()
        if integrity != "ok" or not latest_order:
            raise RuntimeError("Recovered database validation failed")
        os.replace(staging, data_path)
        shutil.copyfile(supplied_environment, runtime_environment)
        os.chmod(runtime_environment, 0o600)

    print("runtime_recovery=complete")
    print(f"recovered_database_handles={len(files)}")
    print(f"recovered_latest_order_at={latest_order}")
    print(f"recovered_process_pid_present={str(pid > 0).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
