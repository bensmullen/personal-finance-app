#!/usr/bin/env python3
"""Operator-only static observation. Run the reviewed copy after merge."""

import argparse
import datetime
import errno
import hashlib
import json
import math
import os
import plistlib
import re
import signal
import stat
import sys
import time
from contextlib import contextmanager
from typing import Callable, Dict, List, Literal, Optional, TypedDict, Union, cast
from xml.parsers.expat import ExpatError


VERSION = re.compile(r"[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[a-z0-9]+(?:\.[a-z0-9]+){0,4})?")
SHA = re.compile(r"[a-f0-9]{40}")
HASH = re.compile(r"[a-f0-9]{64}")
SCHEMA_FILES = ("ClientRequest.json", "ServerNotification.json")
METHODS = {
    "thread_identity_cwd": (0, "thread/start", "ThreadStartParams", {"cwd": "string"}),
    "exact_prompt": (0, "turn/start", "TurnStartParams", {"threadId": "string", "input": "array"}),
    "model_effort": (0, "turn/start", "TurnStartParams", {"model": "string", "effort": "#/definitions/ReasoningEffort"}),
    "permissions": (0, "thread/start", "ThreadStartParams",
                    {"approvalPolicy": "#/definitions/AskForApproval", "sandbox": "#/definitions/SandboxMode"}),
    "turn_start": (0, "turn/start", "TurnStartParams", {"threadId": "string", "input": "array"}),
    "turn_interrupt": (0, "turn/interrupt", "TurnInterruptParams", {"threadId": "string", "turnId": "string"}),
    "terminal": (1, "turn/completed", "TurnCompletedNotification", {"threadId": "string", "turn": "#/definitions/Turn"}),
    "usage": (1, "thread/tokenUsage/updated", "ThreadTokenUsageUpdatedNotification",
              {"threadId": "string", "turnId": "string", "tokenUsage": "#/definitions/ThreadTokenUsage"}),
}


class Ref(TypedDict):
    id: str
    digest: str


class AppMetadata(TypedDict):
    version: str
    build: str
    ref: Ref


class CliMetadata(TypedDict):
    version: Optional[str]
    version_source: Literal["operator-declared", "unobserved"]
    platform: str
    arch: str
    ref: Ref


class ProtocolMetadata(TypedDict):
    layout: Literal["schemars-draft7-unions-v1"]
    source: Literal["operator-declared-static-export"]
    binary: Ref
    version: str
    files: List[Ref]
    features: Dict[str, bool]


ObservationValue = Union[AppMetadata, CliMetadata, ProtocolMetadata]


class Observation(TypedDict):
    status: Literal["observed", "unobserved"]
    reason: Optional[str]
    value: Optional[ObservationValue]


class Report(TypedDict):
    schema: Literal["PFM_LOCAL_CAPABILITY_OBSERVATION_V1"]
    surface: Literal["local"]
    observed_at: str
    head: str
    control_revision: str
    app: Observation
    cli: Observation
    protocol: Observation


class InputError(TypedDict):
    schema: Literal["PFM_LOCAL_CAPABILITY_ERROR_V1"]
    reason: Literal["invalid-input"]


class Refusal(Exception):
    pass


class UniqueDict(dict):
    def __setitem__(self, key, value):
        if key in self:
            raise Refusal("malformed")
        super().__setitem__(key, value)


def unique_pairs(pairs):
    result = UniqueDict()
    for key, value in pairs:
        result[key] = value
    return result


def json_constant(_value):
    raise Refusal("malformed")


def matches(pattern, value, limit=64):
    return isinstance(value, str) and len(value) <= limit and pattern.fullmatch(value) is not None


def descriptor_path(fd):
    if sys.platform == "darwin":
        import fcntl
        return os.fsdecode(fcntl.fcntl(fd, 50, bytes(1024)).split(b"\0", 1)[0])  # F_GETPATH
    if sys.platform == "linux":
        return os.readlink("/proc/self/fd/" + str(fd))
    raise Refusal("unsupported")


def path_parts(path):
    if (not isinstance(path, str) or not 1 < len(path) <= 960 or not path.startswith("/")
            or any(ord(char) < 32 or ord(char) == 127 for char in path)):
        raise Refusal("unsafe-path")
    parts = path[1:].split("/")
    if len(parts) > 24 or any(part in ("", ".", "..") for part in parts):
        raise Refusal("unsafe-path")
    return parts


def safe_identity(info, path):
    shared_temp = (path in ("/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp")
                   and info.st_uid == 0 and info.st_mode & stat.S_ISVTX)
    if info.st_uid not in (0, os.getuid()) or (info.st_mode & 0o022 and not shared_temp):
        raise Refusal("unsafe-path")


def open_component(parent, name, path, directory):
    before = os.stat(name, dir_fd=parent, follow_symlinks=False)
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected_type(before.st_mode) or (not directory and before.st_nlink != 1):
        raise Refusal("unsafe-path")
    safe_identity(before, path)
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(name, flags | (os.O_DIRECTORY if directory else 0), dir_fd=parent)
    try:
        after = os.fstat(fd)
        if before != after or descriptor_path(fd) != path:
            raise Refusal("unsafe-path")
    except BaseException:
        os.close(fd)
        raise
    return fd


@contextmanager
def opened(path, directory=False):
    parts = path_parts(path)
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    current = ""
    try:
        for index, part in enumerate(parts):
            current += "/" + part
            child = open_component(fd, part, current, directory or index < len(parts) - 1)
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def read_content(fd, limit, retain=True):
    before = os.fstat(fd)
    if before.st_size > limit:
        raise Refusal("oversized")
    total = 0
    content = bytearray()
    checksum = hashlib.sha256()
    while total < before.st_size:
        chunk = os.read(fd, min(64 * 1024, before.st_size - total))
        if not chunk:
            raise Refusal("changed")
        total += len(chunk)
        checksum.update(chunk)
        if retain:
            content.extend(chunk)
    after = os.fstat(fd)
    if (before.st_size, before.st_ctime_ns, before.st_mtime_ns, before.st_nlink) != (
            after.st_size, after.st_ctime_ns, after.st_mtime_ns, after.st_nlink):
        raise Refusal("changed")
    return bytes(content), checksum.hexdigest()


def reason(error):
    if isinstance(error, Refusal):
        return str(error)
    if isinstance(error, OSError):
        return {errno.ENOENT: "missing", errno.EACCES: "denied", errno.EPERM: "denied",
                errno.ELOOP: "unsafe-path", errno.ENOTDIR: "unsafe-path"}.get(error.errno, "unobserved")
    return "malformed"


def observe(read: Callable[[], ObservationValue]) -> Observation:
    try:
        return {"status": "observed", "reason": None, "value": read()}
    except (Refusal, OSError, ValueError, TypeError, OverflowError, RecursionError,
            SyntaxError, IndexError, ExpatError, plistlib.InvalidFileException) as error:
        return {"status": "unobserved", "reason": reason(error), "value": None}


def app_metadata(root) -> AppMetadata:
    if path_parts(root)[-1] != "Codex.app":
        raise Refusal("unsafe-path")
    with opened(root + "/Contents/Info.plist") as fd:
        content, checksum = read_content(fd, 128 * 1024)
    info = plistlib.loads(content, dict_type=UniqueDict)
    if not isinstance(info, dict) or info.get("CFBundleIdentifier") != "com.openai.codex":
        raise Refusal("unsupported")
    version, build = info.get("CFBundleShortVersionString"), info.get("CFBundleVersion")
    if not matches(VERSION, version) or not matches(re.compile(r"[0-9]{1,12}(?:\.[0-9]{1,12}){0,2}"), build):
        raise Refusal("unsupported")
    return {"version": version, "build": build, "ref": {"id": "desktop-plist", "digest": checksum}}


def binary_platform(header):
    magic = header[:4]
    if len(header) >= 32 and magic == b"\xcf\xfa\xed\xfe":
        cpu = int.from_bytes(header[4:8], "little")
        if int.from_bytes(header[12:16], "little") == 2 and cpu in (0x01000007, 0x0100000C):
            return "darwin", "x86_64" if cpu == 0x01000007 else "arm64"
    if len(header) >= 64 and header[:7] == b"\x7fELF\x02\x01\x01":
        kind = int.from_bytes(header[16:18], "little")
        cpu = int.from_bytes(header[18:20], "little")
        if kind in (2, 3) and cpu in (62, 183):
            return "linux", "x86_64" if cpu == 62 else "arm64"
    raise Refusal("unsupported")


def cli_metadata(path, declared_version, expected_digest) -> CliMetadata:
    if path_parts(path)[-1] != "codex":
        raise Refusal("unsafe-path")
    with opened(path) as fd:
        if not os.fstat(fd).st_mode & 0o111:
            raise Refusal("unsupported")
        platform, arch = binary_platform(os.pread(fd, 64, 0))
        _, checksum = read_content(fd, 256 * 1024 * 1024, retain=False)
        if binary_platform(os.pread(fd, 64, 0)) != (platform, arch):
            raise Refusal("changed")
    if expected_digest is not None and checksum != expected_digest:
        raise Refusal("binding-mismatch")
    return {"version": declared_version, "version_source": "operator-declared" if declared_version else "unobserved",
            "platform": platform, "arch": arch, "ref": {"id": "cli-binary", "digest": checksum}}


def read_schema(content):
    data = json.loads(content.decode("utf-8"), object_pairs_hook=unique_pairs, parse_constant=json_constant)
    pending = [(data, 0)]
    nodes = 0
    while pending:
        value, depth = pending.pop()
        nodes += 1
        if depth > 32 or nodes > 30_000:
            raise Refusal("oversized")
        if isinstance(value, float) and not math.isfinite(value):
            raise Refusal("malformed")
        if isinstance(value, dict):
            pending.extend((child, depth + 1) for child in value.values())
        elif isinstance(value, list):
            pending.extend((child, depth + 1) for child in value)
    return data


def union_variants(root, filename):
    if (not isinstance(root, dict) or root.get("title") != filename[:-5]
            or root.get("$schema") != "http://json-schema.org/draft-07/schema#"
            or not isinstance(root.get("definitions"), dict) or not isinstance(root.get("oneOf"), list)
            or not root["oneOf"]):
        raise Refusal("unsupported")
    variants = {}
    for variant in root["oneOf"]:
        if not isinstance(variant, dict) or variant.get("type") != "object":
            raise Refusal("unsupported")
        fields = variant.get("properties")
        required = variant.get("required")
        method = fields.get("method") if isinstance(fields, dict) else None
        tags = method.get("enum") if isinstance(method, dict) and method.get("type") == "string" else None
        if (not isinstance(tags, list) or len(tags) != 1 or not isinstance(tags[0], str)
                or not isinstance(required, list) or "method" not in required or tags[0] in variants):
            raise Refusal("unsupported")
        variants[tags[0]] = (fields, required)
    return variants


def field_shape(value, expected, definitions):
    if not isinstance(value, dict):
        return False
    if expected.startswith("#/"):
        name = expected.rsplit("/", 1)[-1]
        target = definitions.get(name)
        if (value.get("$ref") == expected or value.get("allOf") == [{"$ref": expected}]):
            if not isinstance(target, dict):
                return False
            if name in ("ReasoningEffort", "AskForApproval", "SandboxMode", "TurnStatus"):
                return (target.get("type") == "string" and isinstance(target.get("enum"), list)
                        and bool(target["enum"]) and all(isinstance(item, str) for item in target["enum"]))
            return any(key in target for key in ("type", "oneOf", "anyOf"))
        return False
    return value.get("type") in (expected, [expected, "null"])


def typed_object(schema, expected, definitions):
    if not isinstance(schema, dict) or schema.get("type") != "object":
        return False
    properties, required = schema.get("properties"), schema.get("required")
    return (isinstance(properties, dict) and isinstance(required, list)
            and all(key in required and field_shape(properties.get(key), shape, definitions)
                    for key, shape in expected.items()))


def text_input(schema):
    if not isinstance(schema, dict):
        return False
    variants = schema.get("oneOf", [schema])
    if not isinstance(variants, list):
        return False
    return any(typed_object(variant, {"type": "string", "text": "string"}, {})
               and variant["properties"]["type"].get("enum") == ["text"] for variant in variants)


def has_method(root, variants, method, params, properties, request):
    fields, required = variants.get(method, ({}, []))
    definitions = root["definitions"]
    if "params" not in required or (request and ("id" not in required
            or not field_shape(fields.get("id"), "#/definitions/RequestId", definitions))):
        return False
    ref = fields.get("params")
    definition = definitions.get(params)
    if (not isinstance(ref, dict) or ref.get("$ref") != "#/definitions/" + params
            or not isinstance(definition, dict) or definition.get("type") != "object"):
        return False
    fields = definition.get("properties")
    if not isinstance(fields, dict):
        return False
    required = definition.get("required", [])
    for key in ("threadId", "turnId", "input", "turn", "tokenUsage"):
        if key in properties and (not isinstance(required, list) or key not in required):
            return False
    if "input" in properties and (not isinstance(fields.get("input"), dict)
                                  or not field_shape(fields["input"].get("items"),
                                                     "#/definitions/UserInput", definitions)
                                  or not text_input(definitions.get("UserInput"))):
        return False
    if "turn" in properties:
        turn = definitions.get("Turn")
        if not any(typed_object(turn, {"id": "string", "status": shape}, definitions)
                   for shape in ("string", "#/definitions/TurnStatus")):
            return False
    return all(field_shape(fields.get(key), shape, definitions) for key, shape in properties.items())


def static_schema(root, cli: Optional[CliMetadata]) -> ProtocolMetadata:
    if cli is None or cli["version"] is None:
        raise Refusal("binding-mismatch")
    documents, variants, refs = [], [], []
    with opened(root, directory=True) as parent:
        info = os.fstat(parent)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise Refusal("unsafe-path")
        for name in SCHEMA_FILES:
            fd = open_component(parent, name, root + "/" + name, False)
            try:
                content, checksum = read_content(fd, 1024 * 1024)
            finally:
                os.close(fd)
            document = read_schema(content)
            documents.append(document)
            variants.append(union_variants(document, name))
            refs.append({"id": name, "digest": checksum})
    return {"layout": "schemars-draft7-unions-v1", "source": "operator-declared-static-export",
            "binary": cli["ref"], "version": cli["version"], "files": refs,
            "features": {name: has_method(documents[index], variants[index], method, params, fields, index == 0)
                         for name, (index, method, params, fields) in METHODS.items()}}


def timeout(_signum, _frame):
    raise Refusal("deadline")


class Arguments(argparse.ArgumentParser):
    def error(self, _message):
        raise Refusal("invalid-input")


def options():
    parser = Arguments(allow_abbrev=False, add_help=False)
    parser.add_argument("--head", action="append", required=True)
    parser.add_argument("--control-revision", action="append", required=True)
    for name in ("app-root", "cli-path", "cli-version", "cli-sha256", "schema-root"):
        parser.add_argument("--" + name, action="append")
    args = parser.parse_args()
    for name, values in vars(args).items():
        if values is not None and len(values) != 1:
            raise Refusal("invalid-input")
        setattr(args, name, values[0] if values else None)
    if (not matches(SHA, args.head) or not matches(SHA, args.control_revision)
            or bool(args.cli_version) != bool(args.cli_sha256)
            or args.cli_sha256 is not None and not matches(HASH, args.cli_sha256)
            or args.cli_version is not None and not matches(VERSION, args.cli_version)
            or args.schema_root is not None and not all((args.cli_path, args.cli_version, args.cli_sha256))):
        raise Refusal("invalid-input")
    return args


def emit(value: Union[Report, InputError]) -> None:
    print(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False))


def main() -> int:
    try:
        args = options()
    except Refusal:
        emit({"schema": "PFM_LOCAL_CAPABILITY_ERROR_V1", "reason": "invalid-input"})
        return 2
    observed_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    deadline = time.monotonic() + 7.5

    def bounded(read: Callable[[], ObservationValue]) -> Observation:
        def collect():
            started = time.monotonic()
            end = min(started + 2.5, deadline)
            if started >= end:
                raise Refusal("deadline")
            try:
                signal.setitimer(signal.ITIMER_REAL, end - started)
                result = read()
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
            if time.monotonic() > end:
                raise Refusal("deadline")
            return result

        return observe(collect)

    signal.signal(signal.SIGALRM, timeout)
    cli_path = "/Applications/Codex.app/Contents/Resources/codex" if args.cli_path is None else args.cli_path
    app_root = "/Applications/Codex.app" if args.app_root is None else args.app_root
    cli = bounded(lambda: cli_metadata(cli_path, args.cli_version, args.cli_sha256))
    app = bounded(lambda: app_metadata(app_root))
    schema = bounded(lambda: static_schema(args.schema_root, cast(Optional[CliMetadata], cli["value"]))
                     if args.schema_root is not None else no_schema())
    emit({"schema": "PFM_LOCAL_CAPABILITY_OBSERVATION_V1", "surface": "local", "observed_at": observed_at,
          "head": args.head, "control_revision": args.control_revision, "app": app, "cli": cli, "protocol": schema})
    return 0


def no_schema():
    raise Refusal("not-selected")


if __name__ == "__main__":
    sys.exit(main())
