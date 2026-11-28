"""Disposable OS boundary for the real probe. No actual installation is read."""

import errno
import fcntl
import importlib.util
import os
import signal
import stat
import sys
import time
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


probe_path, scenario, plist_fixture, *args = sys.argv[1:]
spec = importlib.util.spec_from_file_location("fixture_probe", probe_path)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

applications = "/Applications"
bundle = applications + "/Codex.app"
contents = bundle + "/Contents"
resources = contents + "/Resources"
cli = resources + "/codex"
plist = contents + "/Info.plist"
sibling = "/Applications-lookalike"
schema = "/fixture-schema"
fixture_dir = Path(__file__).parent
files = {
    cli: bytes.fromhex("cffaedfe0c0000010000000002000000") + bytes(16),
    plist: Path(plist_fixture).read_bytes(),
    **{schema + "/" + name: (fixture_dir / name).read_bytes()
       for name in ("ClientRequest.json", "ServerNotification.json")},
}
files[sibling + "/Codex.app/Contents/Info.plist"] = files[plist]
dirs = ("/", applications, bundle, contents, resources, sibling, sibling + "/Codex.app",
        sibling + "/Codex.app/Contents", schema)
nodes = {}
for inode, path in enumerate((*dirs, *files), 1):
    mode = (stat.S_IFDIR | 0o755 if path in dirs else stat.S_IFREG | (0o755 if path == cli else 0o644))
    nodes[path] = SimpleNamespace(st_dev=1, st_ino=inode, st_mode=mode, st_uid=0, st_gid=0,
                                  st_size=len(files.get(path, b"")), st_ctime_ns=0, st_mtime_ns=0, st_nlink=1)
nodes[applications].st_gid = 80
nodes[schema].st_uid = 501
nodes[schema].st_mode = stat.S_IFDIR | 0o700
if scenario not in ("already-strict", "schema-stat", "schema-post-stat"):
    nodes[applications].st_mode |= 0o020
if scenario == "wrong-owner":
    nodes[applications].st_uid = 501  # A generally allowed owner cannot qualify for the exception.
elif scenario == "wrong-gid":
    nodes[applications].st_gid = 81
elif scenario == "world-write":
    nodes[applications].st_mode |= 0o002
elif scenario == "lookalike":
    nodes[sibling].st_mode |= 0o020
elif scenario == "writable-descendant":
    nodes[resources].st_mode |= 0o020
elif scenario == "writable-file":
    nodes[cli].st_mode |= 0o020
elif scenario == "symlink":
    nodes[cli].st_mode = stat.S_IFLNK | 0o755
elif scenario == "fifo":
    nodes[cli].st_mode = stat.S_IFIFO | 0o755
elif scenario == "hardlink":
    nodes[cli].st_nlink = 2

fds = {}
calls = Counter()
next_fd = 100


def resolve(name, dir_fd):
    if dir_fd is None:
        assert name == "/"
        return name
    assert "/" not in name
    return fds[dir_fd].path.rstrip("/") + "/" + name


def tick(operation, path):
    calls[operation, path] += 1
    return calls[operation, path]


def path_stat(name, *, dir_fd, follow_symlinks):
    assert not follow_symlinks
    path = resolve(name, dir_fd)
    count = tick("stat", path)
    if scenario == "stat" and path == applications:
        raise NotImplementedError("fixture-secret")
    if (scenario, path, count) in (("post-stat", cli, 3), ("schema-stat", schema, 1),
                                   ("schema-post-stat", schema + "/ClientRequest.json", 2)):
        raise NotImplementedError("fixture-secret")
    if scenario == "post-stat-io" and path == cli and count == 3:
        raise OSError(errno.EIO, "fixture-secret")
    if path not in nodes:
        raise FileNotFoundError(errno.ENOENT, "fixture-secret")
    return nodes[path]


def path_open(name, flags, *, dir_fd=None):
    global next_fd
    path = resolve(name, dir_fd)
    assert flags & os.O_NOFOLLOW
    assert bool(flags & os.O_DIRECTORY) == (path in dirs)
    if dir_fd is not None:
        assert flags & os.O_NONBLOCK
    tick("open", path)
    if scenario == "open" and path == cli:
        raise NotImplementedError("fixture-secret")
    if scenario == "root-open" and path == "/":
        raise OSError(errno.ENOSYS, "fixture-secret")
    fds[next_fd] = SimpleNamespace(path=path, info=nodes[path], offset=0)
    next_fd += 1
    return next_fd - 1


def fd_stat(fd):
    entry = fds[fd]
    if scenario == "fstat" and entry.path == cli:
        raise NotImplementedError("fixture-secret")
    return entry.info


def fd_path(fd):
    path = fds[fd].path
    if scenario == "descriptor-path" and path == cli:
        raise OSError(errno.EINVAL, "fixture-secret")
    if scenario == "descriptor-after-read" and path == cli and fds[fd].offset:
        raise NotImplementedError("fixture-secret")
    if scenario == "ancestor-alias" and path == applications:
        return "/alias/Applications"
    if scenario == "descriptor-alias" and path == cli and fds[fd].offset:
        return "/alias/codex"
    return path


def darwin_path(fd, command, buffer):
    assert command == 50 and len(buffer) == 1024
    return fd_path(fd).encode() + b"\0"


def linux_path(path):
    assert path.startswith("/proc/self/fd/")
    if scenario == "proc-unavailable":
        raise FileNotFoundError(errno.ENOENT, "fixture-secret")
    return fd_path(int(path.rsplit("/", 1)[1]))


def fd_read(fd, limit):
    entry = fds[fd]
    content = files[entry.path][entry.offset:entry.offset + limit]
    entry.offset += len(content)
    if entry.path == cli:
        if scenario == "changed-ancestor":
            nodes[contents] = SimpleNamespace(**{**vars(nodes[contents]), "st_ino": 300})
        elif scenario == "changed-root":
            nodes["/"] = SimpleNamespace(**{**vars(nodes["/"]), "st_ino": 300})
        elif scenario == "changed-file":
            nodes[cli] = SimpleNamespace(**{**vars(nodes[cli]), "st_ino": 300})
        elif scenario == "changed-open-file":
            entry.info.st_mtime_ns += 1
        elif scenario == "read":
            raise NotImplementedError("fixture-secret")
    return content


def set_timer(timer, seconds):
    if ((scenario == "timer-arm" and seconds > 0) or (scenario == "timer-clear" and seconds == 0)):
        raise NotImplementedError("fixture-secret")
    return signal.setitimer(timer, seconds)


probe.os = SimpleNamespace(O_RDONLY=os.O_RDONLY, O_NOFOLLOW=os.O_NOFOLLOW, O_NONBLOCK=os.O_NONBLOCK,
                           O_DIRECTORY=os.O_DIRECTORY, stat=path_stat, open=path_open, fstat=fd_stat,
                           getuid=lambda: 501, read=fd_read, close=fds.pop, fsdecode=os.fsdecode, readlink=linux_path)
probe.sys = SimpleNamespace(platform="linux" if scenario in ("wrong-os", "proc-unavailable") else "darwin")
probe.signal = SimpleNamespace(SIGALRM=signal.SIGALRM, ITIMER_REAL=signal.ITIMER_REAL,
                               signal=signal.signal, setitimer=set_timer)
if scenario == "timer-signal":
    del probe.signal.SIGALRM
if scenario == "clock":
    probe.time = SimpleNamespace()
elif scenario == "clock-after-read":
    def monotonic():
        if calls["open", cli]:
            raise NotImplementedError("fixture-secret")
        return time.monotonic()
    probe.time = SimpleNamespace(monotonic=monotonic)

sys.argv = [probe_path, *args]
with patch.object(fcntl, "fcntl", darwin_path):
    result = probe.main()
assert not fds, "probe leaked fixture descriptors"
sys.exit(result)
