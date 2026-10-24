"""Platform helpers for the optional Python graph backends' integration tests."""

import os
from pathlib import Path
import shutil
import signal
import subprocess


def bash_executable():
    override = os.environ.get("GITCH_TEST_BASH")
    if override and Path(override).is_file():
        return override
    if os.name == "nt":
        git = shutil.which("git")
        if git:
            for parent in Path(git).resolve().parents:
                for relative in ("bin/bash.exe", "usr/bin/bash.exe"):
                    candidate = parent / relative
                    if candidate.is_file():
                        return str(candidate)
    return shutil.which("bash") or "bash"


def write_utf8(path, text):
    """Write fixture bytes literally, including LF shell script line endings."""
    return Path(path).write_bytes(text.encode("utf-8"))


def stop_process_tree(pid):
    """Stop only a process tree created by the current isolated test."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=5)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
