"""Deploy main through pinned SSH without copying production credentials or data."""
import base64
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile


def ps_quote(value):
    return "'" + value.replace("'", "''") + "'"


def encoded_command(script):
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + encoded


def configuration(environ):
    names = ("HOST", "USER", "SSH_KEY", "KNOWN_HOSTS", "APP_PATH")
    missing = ["MANGO_DEPLOY_" + n for n in names if not environ.get("MANGO_DEPLOY_" + n, "").strip()]
    if missing:
        raise ValueError("Missing GitHub production secrets: " + ", ".join(missing))
    config = {n: environ["MANGO_DEPLOY_" + n] for n in names}
    config["PORT"] = environ.get("MANGO_DEPLOY_PORT") or "22"
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", config["HOST"]):
        raise ValueError("Invalid deployment host")
    if not re.fullmatch(r"[A-Za-z0-9_.@\\-]+", config["USER"]):
        raise ValueError("Invalid deployment user")
    if not config["PORT"].isdigit() or not 1 <= int(config["PORT"]) <= 65535:
        raise ValueError("Invalid SSH port")
    if any(ord(c) < 32 for c in config["APP_PATH"]):
        raise ValueError("APP_PATH contains an invalid control character")
    if re.match(r"^[A-Za-z]:[\\/]", config["APP_PATH"]):
        config["PLATFORM"] = "windows"
    elif config["APP_PATH"].startswith("/"):
        config["PLATFORM"] = "linux"
    else:
        raise ValueError("APP_PATH must be an absolute Windows or Linux production directory")
    return config


def main():
    config = configuration(os.environ)
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid commit SHA")
    with tempfile.TemporaryDirectory(prefix="mangotcg-deploy-") as directory:
        root = Path(directory)
        key = root / "identity"
        key.write_text(config["SSH_KEY"].rstrip() + "\n")
        key.chmod(0o600)
        known_hosts = root / "known_hosts"
        known_hosts.write_text(config["KNOWN_HOSTS"].rstrip() + "\n")
        ssh_config = root / "config"
        ssh_config.write_text(
            "Host production\n"
            f"  HostName {config['HOST']}\n  User {config['USER']}\n  Port {config['PORT']}\n"
            f"  IdentityFile {key}\n  UserKnownHostsFile {known_hosts}\n"
            "  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n  BatchMode yes\n  ConnectTimeout 15\n"
        )
        ssh_config.chmod(0o600)
        if os.environ.get("MANGO_YOUTUBE_NICKNAME_BACKFILL") == "true":
            if config["PLATFORM"] != "linux":
                raise ValueError("Nickname backfill is available only for Linux production hosts")
            cutoff = os.environ.get("MANGO_BACKFILL_CUTOFF_KST", "")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", cutoff):
                raise ValueError("Invalid cutoff time for nickname backfill")
            incoming = "/root/.mangotcg-incoming/nickname-backfill-" + sha
            subprocess.run(["ssh", "-F", str(ssh_config), "production", f"mkdir -p {incoming}"], check=True)
            subprocess.run([
                "scp", "-F", str(ssh_config), "scripts/backfill-youtube-nickname.mjs",
                "scripts/backfill-youtube-nickname-linux.sh", f"production:{incoming}/",
            ], check=True)
            args = [config["APP_PATH"], incoming, cutoff]
            remote = "bash " + shlex.quote(incoming + "/backfill-youtube-nickname-linux.sh") + " " + " ".join(shlex.quote(value) for value in args)
            subprocess.run(["ssh", "-F", str(ssh_config), "production", remote], check=True)
            return
        if os.environ.get("MANGO_SYNC_AUDITED_ORDERS") == "true":
            if config["PLATFORM"] != "linux":
                raise ValueError("Audited order reconciliation is available only for Linux production hosts")
            incoming = "/root/.mangotcg-incoming/order-sync-" + sha
            subprocess.run(["ssh", "-F", str(ssh_config), "production", f"mkdir -p {incoming}"], check=True)
            subprocess.run([
                "scp", "-F", str(ssh_config), "scripts/reconcile-known-orders-linux.mjs",
                f"production:{incoming}/",
            ], check=True)
            subprocess.run([
                "ssh", "-F", str(ssh_config), "production", "node",
                f"{incoming}/reconcile-known-orders-linux.mjs", config["APP_PATH"],
            ], check=True)
            return
        if os.environ.get("MANGO_RECOVERY_DIAGNOSE") == "true":
            if config["PLATFORM"] != "linux":
                raise ValueError("Recovery diagnosis is available only for Linux production hosts")
            incoming = "/root/.mangotcg-incoming/recovery-diagnose-" + sha
            subprocess.run(["ssh", "-F", str(ssh_config), "production", f"mkdir -p {incoming}"], check=True)
            subprocess.run([
                "scp", "-F", str(ssh_config), "scripts/recovery-diagnose-linux.py",
                f"production:{incoming}/",
            ], check=True)
            subprocess.run([
                "ssh", "-F", str(ssh_config), "production", "python3",
                f"{incoming}/recovery-diagnose-linux.py", config["APP_PATH"],
            ], check=True)
            return
        if os.environ.get("MANGO_RECOVERY_RESTORE") == "true":
            if config["PLATFORM"] != "linux":
                raise ValueError("Runtime recovery is available only for Linux production hosts")
            required = (
                "ADMIN_PRIMARY_ID", "ADMIN_PRIMARY_PASSWORD", "ADMIN_SECONDARY_ID", "ADMIN_SECONDARY_PASSWORD",
                "CAFE24_MALL_ID", "CAFE24_CLIENT_ID", "CAFE24_CLIENT_SECRET", "CAFE24_REDIRECT_URI",
                "CAFE24_TOKEN_ENCRYPTION_KEY", "CAFE24_WEBHOOK_TOKEN",
            )
            missing = [name for name in required if not os.environ.get("MANGO_RECOVERY_" + name)]
            if missing:
                raise ValueError("Missing production runtime recovery secrets")
            environment = root / "runtime.env"
            optional = ("CAFE24_OAUTH_SCOPES", "CAFE24_REWARD_LIVE_ENABLED", "CAFE24_NATIVE_REWARDS_DISABLED", "CAFE24_REWARD_START_AT")
            lines = ["NODE_ENV=production"]
            for name in required + optional:
                value = os.environ.get("MANGO_RECOVERY_" + name)
                if value:
                    lines.append(name + "=" + value)
            environment.write_text("\n".join(lines) + "\n")
            incoming = "/root/.mangotcg-incoming/recovery-" + sha
            subprocess.run(["ssh", "-F", str(ssh_config), "production", f"mkdir -p {incoming}"], check=True)
            archive = root / "release.zip"
            subprocess.run(["git", "archive", "--format=zip", f"--output={archive}", sha], check=True)
            subprocess.run([
                "scp", "-F", str(ssh_config), str(archive), str(environment),
                "scripts/recover-linux-runtime.py", "scripts/deploy-linux-recovery.sh",
                f"production:{incoming}/",
            ], check=True)
            subprocess.run([
                "ssh", "-F", str(ssh_config), "production", "python3",
                f"{incoming}/recover-linux-runtime.py", config["APP_PATH"], f"{incoming}/runtime.env",
            ], check=True)
            subprocess.run([
                "ssh", "-F", str(ssh_config), "production", "bash",
                f"{incoming}/deploy-linux-recovery.sh", "--app-root", config["APP_PATH"],
                "--archive", f"{incoming}/release.zip", "--commit", sha,
            ], check=True)
            return
        archive = root / "release.zip"
        subprocess.run(["git", "archive", "--format=zip", f"--output={archive}", sha], check=True)
        if config["PLATFORM"] == "windows":
            incoming = ".mangotcg-incoming/" + sha
            create = "$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Force -Path (Join-Path $HOME " + ps_quote(incoming) + ") | Out-Null"
            subprocess.run(["ssh", "-F", str(ssh_config), "production", encoded_command(create)], check=True)
            subprocess.run(["scp", "-F", str(ssh_config), str(archive), "scripts/deploy-windows.ps1", f"production:{incoming}/"], check=True)
            command = (
                "$ErrorActionPreference='Stop'; $incoming=Join-Path $HOME " + ps_quote(incoming) + "; "
                "& (Join-Path $incoming 'deploy-windows.ps1') -AppPath " + ps_quote(config["APP_PATH"]) +
                " -ArchivePath (Join-Path $incoming 'release.zip') -CommitSha " + ps_quote(sha)
            )
            subprocess.run(["ssh", "-F", str(ssh_config), "production", encoded_command(command)], check=True)
        else:
            incoming = "/root/.mangotcg-incoming/" + sha
            subprocess.run(["ssh", "-F", str(ssh_config), "production", f"mkdir -p {incoming}"], check=True)
            subprocess.run(["scp", "-F", str(ssh_config), str(archive), "scripts/deploy-linux.sh", f"production:{incoming}/"], check=True)
            subprocess.run([
                "ssh", "-F", str(ssh_config), "production", "bash",
                f"{incoming}/deploy-linux.sh", "--app-root", config["APP_PATH"],
                "--archive", f"{incoming}/release.zip", "--commit", sha,
            ], check=True)
        print("Remote deployment and local health check completed for " + sha)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        # Never echo subprocess arguments: they can contain connection metadata.
        if isinstance(error, ValueError):
            print(str(error))
        else:
            print("Remote deployment failed; review the preceding deployment stage.")
        raise SystemExit(1)
