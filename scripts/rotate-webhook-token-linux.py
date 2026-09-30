"""Update only the Cafe24 webhook token in the active Linux runtime."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    app_root = Path(sys.argv[1]).resolve()
    token_path = Path(sys.argv[2])
    try:
        token = token_path.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"[0-9a-f]{64}", token):
            raise RuntimeError("Invalid webhook token")
        processes = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
        active = [p for p in processes if p.get("name") == "obs-overlay"]
        if len(active) != 1:
            raise RuntimeError("Unique production process was not found")
        runtime = Path(active[0]["pm2_env"]["pm_cwd"]).resolve()
        if not str(runtime).startswith(str(app_root).rstrip("/") + "/mangotcg-release-"):
            raise RuntimeError("Active runtime is outside the production release path")
        environment = runtime / ".env.local"
        original = environment.read_bytes()
        lines = original.decode("utf-8").splitlines()
        positions = [i for i, line in enumerate(lines) if line.startswith("CAFE24_WEBHOOK_TOKEN=")]
        if len(positions) != 1:
            raise RuntimeError("Runtime webhook token entry is missing or duplicated")
        lines[positions[0]] = "CAFE24_WEBHOOK_TOKEN=" + token
        updated = ("\n".join(lines) + "\n").encode("utf-8")
        mode = environment.stat().st_mode & 0o777
        with tempfile.NamedTemporaryFile(dir=runtime, prefix=".env.local-", delete=False) as tmp:
            temporary = Path(tmp.name)
            tmp.write(updated)
        os.chmod(temporary, mode)
        os.replace(temporary, environment)
        try:
            subprocess.run(["pm2", "restart", "obs-overlay", "--update-env"], check=True, stdout=subprocess.DEVNULL)
            for _ in range(10):
                try:
                    with urlopen("http://127.0.0.1:3001/admin/login", timeout=3) as response:
                        if response.status == 200:
                            print("webhook_token_rotated=true admin_login=200")
                            return 0
                except Exception:
                    pass
                time.sleep(2)
            raise RuntimeError("Production health check failed")
        except Exception:
            environment.write_bytes(original)
            subprocess.run(["pm2", "restart", "obs-overlay", "--update-env"], check=False, stdout=subprocess.DEVNULL)
            raise
    finally:
        token_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, subprocess.CalledProcessError, KeyError, ValueError) as error:
        print(f"webhook_token_rotation_failed={type(error).__name__}")
        raise SystemExit(1)
