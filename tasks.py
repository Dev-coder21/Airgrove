"""Project commands (Windows-friendly replacement for make).

Usage: python tasks.py <command>
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
VENV_PY = ROOT / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def run(*args: str) -> int:
    print("$", " ".join(args))
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend"), "PYTHONUTF8": "1"}
    return subprocess.call(list(args), cwd=ROOT, env=env)


def py(*args: str) -> int:
    exe = str(VENV_PY) if VENV_PY.exists() else sys.executable
    return run(exe, *args)


def setup() -> int:
    if not VENV_PY.exists():
        if rc := run(sys.executable, "-m", "venv", ".venv"):
            return rc
    py("-m", "pip", "install", "--upgrade", "pip")
    return py("-m", "pip", "install", "-r", "requirements.txt")


def test() -> int:
    return py("-m", "pytest", "-q")


def lint() -> int:
    return py("-m", "ruff", "check", ".") or py("-m", "ruff", "format", "--check", ".")


def fmt() -> int:
    return py("-m", "ruff", "check", "--fix", ".") or py("-m", "ruff", "format", ".")


def npm(*args: str) -> int:
    exe = shutil.which("npm")
    if not exe:
        print("npm not found: install Node.js 18+")
        return 1
    if not (FRONTEND / "node_modules").exists():
        if rc := subprocess.call([exe, "install"], cwd=FRONTEND):
            return rc
    return subprocess.call([exe, *args], cwd=FRONTEND)


def dev() -> int:
    """Start the Vite dev server on http://localhost:5173."""
    return npm("run", "dev")


def build() -> int:
    return npm("run", "build")


def coverage() -> int:
    """Discover CPCB PM2.5 stations on OpenAQ, group into cities, write reports/coverage.json."""
    return py("-c", "from airgrove.ingest.cli import coverage; coverage()")


def hourcheck() -> int:
    """Fetch 3 days for one Delhi station and check every hour of the day is present."""
    return py("-c", "from airgrove.ingest.cli import hourcheck; hourcheck()")


def download() -> int:
    """OpenAQ history + weather + CAMS + fires (resumable; cached requests are free)."""
    return py(
        "-c",
        "from airgrove.ingest.cli import download_openaq, download_rest; download_openaq(); download_rest()",
    )


def clean() -> int:
    return py("-c", "from airgrove.ingest.cli import clean; clean()")


COMMANDS = {
    "download": download,
    "clean": clean,
    "hourcheck": hourcheck,
    "coverage": coverage,
    "setup": setup,
    "test": test,
    "lint": lint,
    "fmt": fmt,
    "dev": dev,
    "build": build,
}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("commands:", ", ".join(COMMANDS))
        return 1
    return COMMANDS[sys.argv[1]]()


if __name__ == "__main__":
    sys.exit(main())
