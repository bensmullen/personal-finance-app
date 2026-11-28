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
DEFAULT_APP = "/Applications/Codex.app"
DEFAULT_PLIST = DEFAULT_APP + "/Contents/Info.plist"
DEFAULT_CLI = DEFAULT_APP + "/Contents/Resources/codex"
METHODS = {
    "thread_identity_cwd": (0, "thread/start", "ThreadStartParams", (), ("cwd",)),
    "exact_prompt": (0, "turn/start", "TurnStartParams", ("threadId", "input"), ()),
    "model_effort": (0, "turn/start", "TurnStartParams", ("threadId", "input"), ("model", "effort")),
    "permissions": (0, "thread/start", "ThreadStartParams", (), ("approvalPolicy", "sandbox")),
    "turn_start": (0, "turn/start", "TurnStartParams", ("threadId", "input"), ()),
    "turn_interrupt": (0, "turn/interrupt", "TurnInterruptParams", ("threadId", "turnId"), ()),
    "terminal": (1, "turn/completed", "TurnCompletedNotification", ("threadId", "turn"), ()),
    "usage": (1, "thread/tokenUsage/updated", "ThreadTokenUsageUpdatedNotification",
              ("threadId", "turnId", "tokenUsage"), ()),
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


class StrictReport(TypedDict):
    schema: Literal["PFM_LOCAL_CAPABILITY_OBSERVATION_V1"]
    surface: Literal["local"]
    observed_at: str
    head: str
    control_revision: str
    app: Observation
    cli: Observation
    protocol: Observation


class Report(StrictReport, total=False):
    path_policy: Literal["macos-applications-advisory"]


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


def primitive(call, *args, **kwargs):
    try:
        return call(*args, **kwargs)
    except (AttributeError, NotImplementedError):
        raise Refusal("unsupported") from None
    except OSError as error:
        if error.errno in (errno.ENOSYS, errno.ENOTSUP, errno.EOPNOTSUPP):
            raise Refusal("unsupported") from None
        raise


def descriptor_path(fd):
    if sys.platform == "darwin":
        try:
            import fcntl
            result = primitive(lambda: fcntl.fcntl(fd, 50, bytes(1024)))  # F_GETPATH
        except ImportError:
            raise Refusal("unsupported") from None
        except OSError as error:
            if error.errno == errno.EINVAL:
                raise Refusal("unsupported") from None
            raise
        return os.fsdecode(result.split(b"\0", 1)[0])
    if sys.platform == "linux":
        try:
            return primitive(os.readlink, "/proc/self/fd/" + str(fd))
        except FileNotFoundError:
            raise Refusal("unsupported") from None
    raise Refusal("unsupported")


def path_parts(path):
    if (not isinstance(path, str) or not 1 < len(path) <= 960 or not path.startswith("/")
            or any(ord(char) < 32 or ord(char) == 127 for char in path)):
        raise Refusal("unsafe-path")
    parts = path[1:].split("/")
    if len(parts) > 24 or any(part in ("", ".", "..") for part in parts):
        raise Refusal("unsafe-path")
    return parts


def safe_identity(info, path, advisory=False):
    shared_temp = (path in ("/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp")
                   and info.st_uid == 0 and info.st_mode & stat.S_ISVTX)
    applications = (advisory and sys.platform == "darwin" and path == "/Applications"
                    and stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 80
                    and not info.st_mode & 0o002)
    if info.st_uid not in (0, os.getuid()) or (info.st_mode & 0o022 and not (shared_temp or applications)):
        raise Refusal("unsafe-path")


def open_component(parent, name, path, directory, advisory=False):
    before = primitive(os.stat, name, dir_fd=parent, follow_symlinks=False)
    expected_type = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected_type(before.st_mode) or (not directory and before.st_nlink != 1):
        raise Refusal("unsafe-path")
    safe_identity(before, path, advisory)
    flags = primitive(lambda: os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_DIRECTORY if directory else 0))
    fd = primitive(os.open, name, flags, dir_fd=parent)
    try:
        identity = descriptor_identity(fd)
        if file_identity(before) != identity or descriptor_path(fd) != path:
            raise Refusal("unsafe-path")
    except BaseException:
        primitive(os.close, fd)
        raise
    return fd, identity


def file_identity(info):
    return primitive(lambda: (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                              info.st_size, info.st_ctime_ns, info.st_mtime_ns, info.st_nlink))


def descriptor_identity(fd):
    return file_identity(primitive(os.fstat, fd))


@contextmanager
def opened_file(parent, name, path):
    fd, original = open_component(parent, name, path, False)
    try:
        yield fd
        try:
            current = primitive(os.stat, name, dir_fd=parent, follow_symlinks=False)
        except (FileNotFoundError, NotADirectoryError):
            raise Refusal("changed") from None
        if (file_identity(current) != original or descriptor_identity(fd) != original
                or descriptor_path(fd) != path):
            raise Refusal("changed")
    finally:
        primitive(os.close, fd)


@contextmanager
def opened_path(path, directory, ancestry=None):
    parts = path_parts(path)
    fd = primitive(lambda: os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
    current = ""
    try:
        if ancestry is not None:
            root = primitive(os.fstat, fd)
            if not stat.S_ISDIR(root.st_mode) or descriptor_path(fd) != "/":
                raise Refusal("unsafe-path")
            safe_identity(root, "/")
            ancestry.append(file_identity(root))
        for index, part in enumerate(parts):
            current += "/" + part
            if not directory and index == len(parts) - 1:
                with opened_file(fd, part, current) as child:
                    yield child
                return
            child, identity = open_component(fd, part, current, True, ancestry is not None)
            parent, fd = fd, child
            primitive(os.close, parent)
            if ancestry is not None:
                ancestry.append(identity)
        yield fd
    finally:
        primitive(os.close, fd)


@contextmanager
def opened(path, directory=False, advisory=False):
    if advisory and (directory or path not in (DEFAULT_PLIST, DEFAULT_CLI)):
        raise Refusal("unsafe-path")
    ancestry = [] if advisory else None
    with opened_path(path, directory, ancestry) as fd:
        if ancestry is None:
            yield fd
            return
        original = descriptor_identity(fd)
        yield fd
        # Rewalk the selected path from root while the original file is still open.
        current = []
        with opened_path(path, False, current) as rebound:
            if current != ancestry or descriptor_identity(rebound) != original:
                raise Refusal("changed")


def read_content(fd, path, limit, retain_limit):
    before = primitive(os.fstat, fd)
    if before.st_size > limit:
        raise Refusal("oversized")
    total = 0
    content = bytearray()
    checksum = hashlib.sha256()
    while total < before.st_size:
        chunk = primitive(os.read, fd, min(64 * 1024, before.st_size - total))
        if not chunk:
            raise Refusal("changed")
        total += len(chunk)
        checksum.update(chunk)
        if len(content) < retain_limit:
            content.extend(chunk[:retain_limit - len(content)])
    after = primitive(os.fstat, fd)
    if file_identity(before) != file_identity(after) or after.st_nlink != 1:
        raise Refusal("changed")
    if descriptor_path(fd) != path:
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
            SyntaxError, LookupError, ExpatError, plistlib.InvalidFileException) as error:
        return {"status": "unobserved", "reason": reason(error), "value": None}


def app_metadata(root, advisory=False) -> AppMetadata:
    if path_parts(root)[-1] != "Codex.app":
        raise Refusal("unsafe-path")
    path = root + "/Contents/Info.plist"
    with opened(path, advisory=advisory) as fd:
        content, checksum = read_content(fd, path, 128 * 1024, 128 * 1024)
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


def cli_metadata(path, declared_version, expected_digest, advisory=False) -> CliMetadata:
    if path_parts(path)[-1] != "codex":
        raise Refusal("unsafe-path")
    with opened(path, advisory=advisory) as fd:
        if not primitive(os.fstat, fd).st_mode & 0o111:
            raise Refusal("unsupported")
        header, checksum = read_content(fd, path, 256 * 1024 * 1024, 64)
        platform, arch = binary_platform(header)
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


def shape(schema, keys):
    # Only these annotations and explicitly recognized assertion forms are
    # evaluated. Additional keywords can contradict the apparent shape.
    return (isinstance(schema, dict) and schema.keys() <= set(keys) | {"title", "description", "default"}
            and all(isinstance(schema[key], str) for key in ("title", "description") if key in schema))


def object_fields(schema):
    if (not shape(schema, ("type", "properties", "required", "additionalProperties"))
            or schema.get("type") != "object" or not isinstance(schema.get("properties"), dict)
            or type(schema.get("additionalProperties", True)) is not bool):
        return None
    fields, required = schema["properties"], schema.get("required", [])
    if (not isinstance(required, list) or not all(isinstance(key, str) and key in fields for key in required)
            or len(set(required)) != len(required)
            or not all(isinstance(value, (dict, bool)) for value in fields.values())):
        return None
    return fields, set(required)


def tagged_variants(variants, tag):
    if not isinstance(variants, list) or not variants:
        return None
    result = {}
    for variant in variants:
        obj = object_fields(variant)
        if obj is None:
            return None
        fields, required = obj
        discriminator = fields.get(tag)
        if (tag not in required or not shape(discriminator, ("type", "enum"))
                or discriminator.get("type") != "string"):
            return None
        tags = discriminator.get("enum")
        if not isinstance(tags, list) or len(tags) != 1 or not isinstance(tags[0], str) or tags[0] in result:
            return None
        result[tags[0]] = obj
    return result


def union_variants(root, filename):
    if (not shape(root, ("$schema", "oneOf", "definitions")) or root.get("title") != filename[:-5]
            or root.get("$schema") != "http://json-schema.org/draft-07/schema#"
            or not isinstance(root.get("definitions"), dict)):
        raise Refusal("unsupported")
    variants = tagged_variants(root.get("oneOf"), "method")
    if variants is None:
        raise Refusal("unsupported")
    return variants


def string_field(value, nullable=False):
    return (shape(value, ("type",))
            and (value.get("type") == "string" or nullable and value.get("type") == ["string", "null"]))


def reference(value, name, definitions, nullable=False):
    pointer = {"$ref": "#/definitions/" + name}
    if nullable and shape(value, ("anyOf",)):
        options = value.get("anyOf")
        if not isinstance(options, list) or len(options) != 2 or {"type": "null"} not in options:
            return None
        value = options[1] if options[0] == {"type": "null"} else options[0]
    if (shape(value, ("$ref",)) and value.get("$ref") == pointer["$ref"]
            or shape(value, ("allOf",)) and value.get("allOf") == [pointer]):
        return definitions.get(name)
    return None


def integer_field(value, formats, minimum=None):
    return (shape(value, ("type", "format", "minimum"))
            and value.get("type") == "integer" and value.get("format") in formats
            and (type(value.get("minimum")) is int and value["minimum"] == minimum
                 if minimum is not None else "minimum" not in value))


def request_id(value):
    if string_field(value):
        return True
    if not shape(value, ("anyOf",)) or not isinstance(value.get("anyOf"), list) or len(value["anyOf"]) != 2:
        return False
    first, second = value["anyOf"]
    return any(string_field(text) and integer_field(number, (None, "int64")) for text, number in
               ((first, second), (second, first)))


def named_enum(value, known, needed=()):
    if not shape(value, ("type", "enum")) or value.get("type") != "string":
        return False
    choices = value.get("enum")
    return (isinstance(choices, list) and bool(choices) and all(isinstance(item, str) for item in choices)
            and len(set(choices)) == len(choices) and set(needed) <= set(choices) <= set(known))


def required_fields(value, checks):
    obj = object_fields(value)
    if obj is None:
        return False
    fields, required = obj
    return required == checks.keys() and all(check(fields[key]) for key, check in checks.items())


def text_input(value, definitions):
    if not shape(value, ("type", "items")) or value.get("type") != "array":
        return False
    schema = reference(value.get("items"), "UserInput", definitions)
    variants = tagged_variants(schema.get("oneOf") if shape(schema, ("oneOf",)) and "oneOf" in schema
                               else [schema], "type")
    fields, required = variants.get("text", ({}, set())) if variants is not None else ({}, set())
    return required == {"type", "text"} and string_field(fields.get("text"))


def feature_field(name, value, definitions):
    if name in ("threadId", "turnId"):
        return string_field(value)
    if name in ("cwd", "model"):
        return string_field(value, nullable=True)
    if name == "input":
        return text_input(value, definitions)
    if name == "approvalPolicy":
        return named_enum(reference(value, "AskForApproval", definitions, nullable=True),
                          ("never", "on-request", "on-failure", "untrusted"))
    if name == "sandbox":
        return named_enum(reference(value, "SandboxMode", definitions, nullable=True),
                          ("read-only", "workspace-write", "danger-full-access"))
    if name == "effort":
        return named_enum(reference(value, "ReasoningEffort", definitions, nullable=True),
                          ("none", "minimal", "low", "medium", "high", "xhigh"))
    if name == "turn":
        def terminal(status):
            if not shape(status, ("type", "enum")):
                status = reference(status, "TurnStatus", definitions)
            return named_enum(status, ("completed", "interrupted", "failed", "inProgress"),
                              ("completed", "interrupted", "failed"))
        return required_fields(reference(value, "Turn", definitions), {"id": string_field, "status": terminal})
    if name == "tokenUsage":
        def breakdown(value):
            def count(value):
                return integer_field(value, (None, "uint32", "uint64"), minimum=0)
            return required_fields(reference(value, "TokenUsageBreakdown", definitions),
                                   {key: count for key in ("inputTokens", "outputTokens", "totalTokens")})
        return required_fields(reference(value, "ThreadTokenUsage", definitions),
                               {"last": breakdown, "total": breakdown})
    return False


def has_method(root, variants, method, params, needed, declarations, request):
    fields, required = variants.get(method, ({}, set()))
    definitions = root["definitions"]
    if required != ({"method", "id", "params"} if request else {"method", "params"}):
        return False
    if request and not request_id(reference(fields.get("id"), "RequestId", definitions)):
        return False
    obj = object_fields(reference(fields.get("params"), params, definitions))
    if obj is None:
        return False
    fields, required = obj
    return (set(needed) <= required <= set(needed + declarations)
            and all(feature_field(key, fields.get(key), definitions) for key in needed + declarations))


def static_schema(root, cli: Optional[CliMetadata]) -> ProtocolMetadata:
    if cli is None or cli["version"] is None:
        raise Refusal("binding-mismatch")
    documents, variants, refs = [], [], []
    with opened(root, directory=True) as parent:
        info = primitive(os.fstat, parent)
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise Refusal("unsafe-path")
        for name in SCHEMA_FILES:
            with opened_file(parent, name, root + "/" + name) as fd:
                content, checksum = read_content(fd, root + "/" + name, 1024 * 1024, 1024 * 1024)
            document = read_schema(content)
            documents.append(document)
            variants.append(union_variants(document, name))
            refs.append({"id": name, "digest": checksum})
    return {"layout": "schemars-draft7-unions-v1", "source": "operator-declared-static-export",
            "binary": cli["ref"], "version": cli["version"], "files": refs,
            "features": {name: has_method(documents[index], variants[index], method, params, needed, declarations, index == 0)
                         for name, (index, method, params, needed, declarations) in METHODS.items()}}


class Arguments(argparse.ArgumentParser):
    def error(self, _message):
        raise Refusal("invalid-input")


def options():
    parser = Arguments(allow_abbrev=False, add_help=False)
    parser.add_argument("--head", action="append", required=True)
    parser.add_argument("--control-revision", action="append", required=True)
    parser.add_argument("--allow-macos-applications-advisory", action="append_const", const=True)
    overrides = ("app-root", "cli-path", "cli-version", "cli-sha256", "schema-root")
    for name in overrides:
        parser.add_argument("--" + name, action="append")
    args = parser.parse_args()
    for name, values in vars(args).items():
        if values is not None and len(values) != 1:
            raise Refusal("invalid-input")
        setattr(args, name, values[0] if values else None)
    if (not matches(SHA, args.head) or not matches(SHA, args.control_revision)
            or args.allow_macos_applications_advisory and any(
                getattr(args, name.replace("-", "_")) is not None for name in overrides)
            or bool(args.cli_version) != bool(args.cli_sha256)
            or args.cli_sha256 is not None and not matches(HASH, args.cli_sha256)
            or args.cli_version is not None and not matches(VERSION, args.cli_version)
            or args.schema_root is not None and not all((args.cli_path, args.cli_version, args.cli_sha256))):
        raise Refusal("invalid-input")
    return args


def emit(value: Union[Report, InputError]) -> None:
    print(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False))


def timer_primitive(call):
    try:
        return primitive(call)
    except ValueError:
        raise Refusal("unsupported") from None


def start_clock(on_timeout):
    deadline = primitive(lambda: time.monotonic()) + 7.5
    timer_primitive(lambda: signal.signal(signal.SIGALRM, on_timeout))
    return deadline


def main() -> int:
    try:
        args = options()
    except Refusal:
        emit({"schema": "PFM_LOCAL_CAPABILITY_ERROR_V1", "reason": "invalid-input"})
        return 2
    observed_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    timer_active = False

    def on_timeout(_signum, _frame):
        if timer_active:
            raise Refusal("deadline")

    try:
        deadline = start_clock(on_timeout)
    except (Refusal, OSError) as error:
        clock_error = reason(error)
        deadline = None

    def bounded(read: Callable[[], ObservationValue]) -> Observation:
        if deadline is None:
            return {"status": "unobserved", "reason": clock_error, "value": None}

        def collect():
            nonlocal timer_active
            started = primitive(lambda: time.monotonic())
            end = min(started + 2.5, deadline)
            if started >= end:
                raise Refusal("deadline")
            armed = False
            try:
                timer_primitive(lambda: signal.setitimer(signal.ITIMER_REAL, end - started))
                armed = True
                timer_active = True
                result = read()
            finally:
                timer_active = False
                if armed:
                    timer_primitive(lambda: signal.setitimer(signal.ITIMER_REAL, 0))
            if primitive(lambda: time.monotonic()) > end:
                raise Refusal("deadline")
            return result

        return observe(collect)

    advisory = args.allow_macos_applications_advisory is True
    cli_path = DEFAULT_CLI if args.cli_path is None else args.cli_path
    app_root = DEFAULT_APP if args.app_root is None else args.app_root
    cli = bounded(lambda: cli_metadata(cli_path, args.cli_version, args.cli_sha256, advisory))
    app = bounded(lambda: app_metadata(app_root, advisory))
    schema = (observe(no_schema) if args.schema_root is None else
              bounded(lambda: static_schema(args.schema_root, cast(Optional[CliMetadata], cli["value"]))))
    report: Report = {"schema": "PFM_LOCAL_CAPABILITY_OBSERVATION_V1", "surface": "local", "observed_at": observed_at,
                      "head": args.head, "control_revision": args.control_revision, "app": app, "cli": cli, "protocol": schema}
    if advisory:
        report["path_policy"] = "macos-applications-advisory"
    emit(report)
    return 0


def no_schema():
    raise Refusal("not-selected")


if __name__ == "__main__":
    sys.exit(main())
