#!/usr/bin/env python3
"""LogTide hardware agent.

Collects hardware health signals (SMART, EDAC, hwmon, thermal throttling, IPMI,
NIC counters, kernel and BMC events) and ships them to LogTide:

  * metrics as OTLP JSON gauges to      POST {LOGTIDE_URL}/v1/otlp/metrics
  * events  as logs (service=hardware) to POST {LOGTIDE_URL}/api/v1/ingest

Single file, Python 3.8+, standard library only.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import namedtuple
from datetime import datetime, timezone

AGENT_VERSION = "1.7.0"
SERVICE_NAME = "logtide-hw-agent"
EVENT_SERVICE = "hardware"

log = logging.getLogger("logtide-hw-agent")

# Collectors that report hw.agent.collector.status (contract names).
ALL_COLLECTORS = ("smart", "edac", "hwmon", "thermal", "ipmi", "sel", "net", "kmsg")

# One data point before it is encoded as OTLP.
Metric = namedtuple("Metric", "name value hw_type hw_id attrs")

UNITS = {
    "hw.host.info": "1",
    "hw.agent.collector.status": "1",
    "hw.physical_disk.smart_status": "1",
    "hw.physical_disk.smart": "1",
    "hw.physical_disk.endurance_utilization": "%",
    "hw.physical_disk.available_spare": "%",
    "hw.physical_disk.available_spare_threshold": "%",
    "hw.physical_disk.media_errors": "1",
    "hw.physical_disk.critical_warning": "1",
    "hw.temperature": "Cel",
    "hw.temperature.limit": "Cel",
    "hw.fan.speed": "rpm",
    "hw.fan.speed.limit": "rpm",
    "hw.voltage": "V",
    "hw.voltage.limit": "V",
    "hw.power_supply.status": "1",
    "hw.memory.errors": "1",
    "hw.memory.size": "By",
    "hw.cpu.throttle_count": "1",
    "hw.network.errors": "1",
    "hw.network.carrier_changes": "1",
    "hw.network.up": "1",
}


class CollectorUnavailable(Exception):
    """The data source of a collector is not present on this host."""


# ---------------------------------------------------------------------------
# Config and context
# ---------------------------------------------------------------------------

def _int(value, default, minimum=None):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if minimum is not None and n < minimum:
        return minimum
    return n


def read_text(path):
    try:
        with open(path, "r") as f:
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def read_int(path):
    text = read_text(path)
    if text is None:
        return None
    try:
        return int(text.strip())
    except ValueError:
        return None


def read_str(path):
    text = read_text(path)
    return text.strip() if text is not None else None


def _list_dir(path):
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


class Config(object):
    def __init__(self, env=None):
        env = os.environ if env is None else env
        self.url = (env.get("LOGTIDE_URL") or "").rstrip("/")
        self.api_key = env.get("LOGTIDE_API_KEY") or ""
        self.host_root = (env.get("HOST_ROOT") or "").rstrip("/\\")
        self.interval = _int(env.get("LOGTIDE_HW_INTERVAL"), 60, minimum=5)
        self.state_dir = env.get("LOGTIDE_HW_STATE_DIR") or "/var/lib/logtide-hw-agent"
        self.dry_run = (env.get("LOGTIDE_HW_DRY_RUN") or "").lower() in ("1", "true", "yes")
        raw = env.get("LOGTIDE_HW_COLLECTORS")
        if raw and raw.strip():
            wanted = [c.strip().lower() for c in raw.split(",") if c.strip()]
            self.collectors = [c for c in ALL_COLLECTORS if c in wanted]
        else:
            self.collectors = list(ALL_COLLECTORS)
        self.kmsg_path = env.get("LOGTIDE_HW_KMSG_PATH") or "/dev/kmsg"
        self._hostname = env.get("LOGTIDE_HOSTNAME") or ""

    def path(self, p):
        return self.host_root + p

    @property
    def hostname(self):
        if self._hostname:
            return self._hostname
        name = (read_text(self.path("/etc/hostname")) or "").strip()
        if name:
            name = name.splitlines()[0].strip()
        return name or socket.gethostname()


class Context(object):
    """Everything a collector needs. Tests replace `run` and the config."""

    def __init__(self, config):
        self.config = config
        self.events = []  # events produced by collectors (sel)
        self.kmsg = None  # KmsgReader, set by the agent loop
        self._unavailable_logged = set()

    def path(self, p):
        return self.config.path(p)

    def smartctl_available(self):
        return shutil.which("smartctl") is not None

    def run(self, args, timeout=60):
        """Run a command, return (returncode, stdout). Raises CollectorUnavailable
        when the binary is missing. A non-zero exit is not an error here: smartctl
        reports problems through its exit bitmask while still printing valid JSON."""
        try:
            proc = subprocess.run(
                args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout,
            )
        except FileNotFoundError:
            raise CollectorUnavailable("%s not installed" % args[0])
        except subprocess.TimeoutExpired:
            raise RuntimeError("%s timed out" % args[0])
        return proc.returncode, proc.stdout.decode("utf-8", "replace")


# ---------------------------------------------------------------------------
# smart
# ---------------------------------------------------------------------------

ATA_ATTRIBUTES = {
    5: "reallocated_sector_count",
    197: "current_pending_sector",
    198: "offline_uncorrectable",
    187: "reported_uncorrect",
    199: "udma_crc_error_count",
    188: "command_timeout",
    196: "reallocated_event_count",
    9: "power_on_hours",
}
# Normalized "life left" attributes: used percentage = 100 - normalized value.
ATA_WEAR_IDS = (231, 233, 177)


def _num(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def disk_ident(data, by_id=None):
    """Stable disk identity: serial (spaces stripped), else the /dev/disk/by-id
    name, else the device basename. /dev/sdX letters swap across reboots."""
    dev = data.get("device") or {}
    name = dev.get("name") or ""
    base = os.path.basename(name.rstrip("/")) or name
    serial = re.sub(r"\s+", "", str(data.get("serial_number") or ""))
    if serial:
        return serial
    if by_id and by_id.get(base):
        return by_id[base]
    dtype = str(dev.get("type") or "")
    if "," in dtype:
        base = "%s-%s" % (base, dtype.replace(",", ""))
    return base


def parse_smart_device(data, by_id=None):
    """Turn one `smartctl -a -j` document into metrics. Pure. hw.id is the disk
    identity (see disk_ident), `device` the current kernel name (sda, nvme0)."""
    dev = data.get("device") or {}
    name = dev.get("name") or ""
    if not name:
        return []
    support = data.get("smart_support")
    if isinstance(support, dict) and support.get("available") is False:
        return []

    protocol = str(dev.get("protocol") or "").lower() or "unknown"
    nvme = data.get("nvme_smart_health_information_log")
    ata = (data.get("ata_smart_attributes") or {}).get("table")
    has_status = isinstance(data.get("smart_status"), dict) and "passed" in data["smart_status"]
    has_scsi = "scsi_grown_defect_list" in data
    if not (has_status or nvme or ata or has_scsi):
        return []

    ident = disk_ident(data, by_id)
    device = os.path.basename(name.rstrip("/")) or name

    base = {"device": device, "protocol": protocol}
    if data.get("model_name"):
        base["model"] = str(data["model_name"])
    if data.get("serial_number"):
        base["serial"] = str(data["serial_number"])

    out = []

    def add(metric, value, extra=None):
        if value is None:
            return
        attrs = dict(base)
        if extra:
            attrs.update(extra)
        out.append(Metric(metric, value, "physical_disk", ident, attrs))

    if has_status:
        add("hw.physical_disk.smart_status", 1 if data["smart_status"]["passed"] else 0)

    smart = {}
    if isinstance(ata, list):
        by_id = {}
        for row in ata:
            if isinstance(row, dict) and isinstance(row.get("id"), int):
                by_id[row["id"]] = row
        for attr_id, label in ATA_ATTRIBUTES.items():
            row = by_id.get(attr_id)
            if row is None:
                continue
            raw = _num((row.get("raw") or {}).get("value"))
            if raw is not None:
                smart[label] = raw
        for attr_id in ATA_WEAR_IDS:
            row = by_id.get(attr_id)
            normalized = _num(row.get("value")) if row else None
            if normalized is not None:
                add("hw.physical_disk.endurance_utilization", max(0, min(100, 100 - normalized)))
                break

    if has_scsi:
        grown = _num(data.get("scsi_grown_defect_list"))
        if grown is not None:
            smart["reallocated_sector_count"] = grown

    if "power_on_hours" not in smart:
        hours = _num((data.get("power_on_time") or {}).get("hours"))
        if hours is not None:
            smart["power_on_hours"] = hours

    if isinstance(nvme, dict):
        add("hw.physical_disk.critical_warning", _num(nvme.get("critical_warning")))
        add("hw.physical_disk.available_spare", _num(nvme.get("available_spare")))
        add("hw.physical_disk.available_spare_threshold", _num(nvme.get("available_spare_threshold")))
        add("hw.physical_disk.endurance_utilization", _num(nvme.get("percentage_used")))
        add("hw.physical_disk.media_errors", _num(nvme.get("media_errors")))
        poh = _num(nvme.get("power_on_hours"))
        if poh is not None:
            smart["power_on_hours"] = poh

    for label, value in smart.items():
        add("hw.physical_disk.smart", value, {"smart_attribute": label})

    temp = _num((data.get("temperature") or {}).get("current"))
    if temp is not None:
        add("hw.temperature", temp, {"sensor": "smart"})
    return out


def read_by_id_map(dev_root="/dev/disk/by-id"):
    """Map kernel device basename (sda, nvme0n1, nvme0) to a by-id name."""
    mapping = {}
    for entry in _list_dir(dev_root):
        if "-part" in entry or entry.startswith(("wwn-", "nvme-eui.", "nvme-nvme.")):
            continue
        try:
            target = os.path.basename(os.path.realpath(os.path.join(dev_root, entry)))
        except OSError:
            continue
        mapping.setdefault(target, entry)
        # nvme0n1 -> nvme0 (smartctl reports the controller node)
        m = re.match(r"^(nvme\d+)n\d+$", target)
        if m:
            mapping.setdefault(m.group(1), entry)
    return mapping


def collect_smart(ctx):
    _, out = ctx.run(["smartctl", "--scan-open", "-j"])
    try:
        scan = json.loads(out)
    except ValueError:
        raise RuntimeError("smartctl --scan-open returned no JSON")
    devices = scan.get("devices") or []
    if not devices:
        raise CollectorUnavailable("smartctl found no devices")
    metrics = []
    failed = 0
    by_id = read_by_id_map()
    for d in devices:
        name = d.get("name")
        if not name:
            continue
        args = ["smartctl", "-a", "-j", name]
        if d.get("type"):
            args += ["-d", d["type"]]
        try:
            _, doc = ctx.run(args)
            metrics.extend(parse_smart_device(json.loads(doc), by_id))
        except CollectorUnavailable:
            raise
        except Exception as e:
            failed += 1
            log.warning("smart: %s failed: %s", name, e)
    if failed == len(devices):
        raise RuntimeError("smartctl failed on every device")
    return metrics


# ---------------------------------------------------------------------------
# edac
# ---------------------------------------------------------------------------

def collect_edac(ctx):
    base = ctx.path("/sys/devices/system/edac/mc")
    controllers = [d for d in _list_dir(base) if re.match(r"^mc\d+$", d)]
    if not controllers:
        raise CollectorUnavailable("no EDAC memory controllers")
    metrics = []
    for mc in controllers:
        mc_dir = base + "/" + mc
        for kind, fname in (("corrected", "ce_count"), ("uncorrected", "ue_count")):
            v = read_int(mc_dir + "/" + fname)
            if v is not None:
                metrics.append(Metric("hw.memory.errors", v, "memory", mc,
                                      {"error_type": kind, "scope": "controller", "controller": mc}))
        for dimm in _list_dir(mc_dir):
            if not re.match(r"^dimm\d+$", dimm):
                continue
            d_dir = mc_dir + "/" + dimm
            label = read_str(d_dir + "/dimm_label")
            hw_id = "%s/%s" % (mc, dimm)
            for kind, fname in (("corrected", "dimm_ce_count"), ("uncorrected", "dimm_ue_count")):
                v = read_int(d_dir + "/" + fname)
                if v is not None:
                    attrs = {"error_type": kind, "scope": "dimm", "controller": mc}
                    if label:
                        attrs["dimm_label"] = label
                    metrics.append(Metric("hw.memory.errors", v, "memory", hw_id, attrs))
    return metrics


# ---------------------------------------------------------------------------
# hwmon
# ---------------------------------------------------------------------------

CPU_CHIPS = ("coretemp", "k10temp", "zenpower")
DISK_CHIPS = ("nvme", "drivetemp")
GPU_CHIPS = ("amdgpu", "nouveau", "radeon")


def hwmon_type(chip):
    if chip in CPU_CHIPS:
        return "cpu"
    if chip in DISK_CHIPS:
        return "physical_disk"
    if chip in GPU_CHIPS:
        return "gpu"
    return "board"


def _chip_suffix(h_dir):
    """Stable chip identity from the `device` symlink (e.g. nvme0, coretemp.0)."""
    link = h_dir + "/device"
    try:
        if os.path.islink(link):
            return os.path.basename(os.path.realpath(link))
    except OSError:
        pass
    return None


def collect_hwmon(ctx):
    base = ctx.path("/sys/class/hwmon")
    dirs = [d for d in _list_dir(base) if re.match(r"^hwmon\d+$", d)]
    if not dirs:
        raise CollectorUnavailable("no hwmon devices")
    # SMART already reports disk temperatures, do not double them up.
    skip_disks = "smart" in ctx.config.collectors and ctx.smartctl_available()
    chips = []
    for d in dirs:
        name = read_str(base + "/" + d + "/name")
        if not name or (skip_disks and name in DISK_CHIPS):
            continue
        chips.append((d, name))
    counts = {}
    for _, name in chips:
        counts[name] = counts.get(name, 0) + 1

    metrics = []
    for d, name in chips:
        h_dir = base + "/" + d
        suffix = _chip_suffix(h_dir)
        chip_id = name
        if suffix:
            chip_id = "%s-%s" % (name, suffix)
        elif counts[name] > 1:
            chip_id = "%s-%s" % (name, d[len("hwmon"):])
        is_disk = name in DISK_CHIPS
        entries = _list_dir(h_dir)
        label_of = {}
        for e in entries:
            m = re.match(r"^((?:temp|in|fan)\d+)_label$", e)
            if m:
                label_of[m.group(1)] = read_str(h_dir + "/" + e)
        for e in entries:
            m = re.match(r"^(temp|fan|in)(\d+)_(input|max|crit|min)$", e)
            if not m:
                continue
            kind, idx, field = m.groups()
            sensor = "hwmon" if is_disk else (label_of.get(kind + idx) or (kind + idx))
            raw = read_int(h_dir + "/" + e)
            if raw is None:
                continue
            if kind == "temp":
                htype = hwmon_type(name)
                if field == "input":
                    metrics.append(Metric("hw.temperature", raw / 1000.0, htype, chip_id,
                                          {"sensor": sensor}))
                elif field in ("max", "crit") and raw > 0:
                    metrics.append(Metric("hw.temperature.limit", raw / 1000.0, htype, chip_id,
                                          {"sensor": sensor,
                                           "limit_type": "high" if field == "max" else "critical"}))
            elif kind == "fan":
                if field == "input":
                    metrics.append(Metric("hw.fan.speed", raw, "fan", chip_id, {"sensor": sensor}))
            else:
                if field == "input":
                    metrics.append(Metric("hw.voltage", raw / 1000.0, "voltage", chip_id,
                                          {"sensor": sensor}))
                elif field in ("min", "max") and raw > 0:
                    metrics.append(Metric("hw.voltage.limit", raw / 1000.0, "voltage", chip_id,
                                          {"sensor": sensor,
                                           "limit_type": "low" if field == "min" else "high"}))
    return metrics


# ---------------------------------------------------------------------------
# thermal throttling
# ---------------------------------------------------------------------------

def collect_thermal(ctx):
    base = ctx.path("/sys/devices/system/cpu")
    packages = {}
    found = False
    for cpu in _list_dir(base):
        if not re.match(r"^cpu\d+$", cpu):
            continue
        t_dir = base + "/" + cpu + "/thermal_throttle"
        core = read_int(t_dir + "/core_throttle_count")
        pkg = read_int(t_dir + "/package_throttle_count")
        if core is None and pkg is None:
            continue
        found = True
        pid = read_int(base + "/" + cpu + "/topology/physical_package_id")
        entry = packages.setdefault(pid if pid is not None else 0, {"core": 0, "package": 0})
        if core is not None:
            entry["core"] = max(entry["core"], core)
        if pkg is not None:
            entry["package"] = max(entry["package"], pkg)
    if not found:
        raise CollectorUnavailable("no thermal_throttle counters")
    metrics = []
    for pid in sorted(packages):
        for ttype in ("core", "package"):
            metrics.append(Metric("hw.cpu.throttle_count", packages[pid][ttype], "cpu",
                                  "package%d" % pid, {"throttle_type": ttype}))
    return metrics


# ---------------------------------------------------------------------------
# ipmi sensors
# ---------------------------------------------------------------------------

def _float_or_none(s):
    s = s.strip()
    if not s or s.lower() in ("na", "n/a"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def ipmi_temp_type(name):
    n = name.lower()
    if "cpu" in n or "proc" in n:
        return "cpu"
    if "dimm" in n or "mem" in n:
        return "memory"
    if "gpu" in n:
        return "gpu"
    return "board"


ENTITY_TYPES = {3: "cpu", 9: "cpu", 18: "cpu", 8: "memory", 32: "memory"}


def parse_sdr_entities(text):
    """Parse `ipmitool sdr elist full` into {sensor name: [hw.type per occurrence]}
    using the IPMI entity id (3 processor, 8/32 memory, ...). Pure."""
    out = {}
    for line in text.splitlines():
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 4 or not cols[0]:
            continue
        try:
            entity = int(cols[3].split(".")[0])
        except ValueError:
            continue
        out.setdefault(cols[0], []).append(ENTITY_TYPES.get(entity, "board"))
    return out


def _ipmi_rows(text):
    """Sensor rows with names made unique: repeated names get -2, -3 in order."""
    rows = []
    seen = {}
    for line in text.splitlines():
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 10 or not cols[0]:
            continue
        n = seen.get(cols[0], 0)
        seen[cols[0]] = n + 1
        uname = cols[0] if n == 0 else "%s-%d" % (cols[0], n + 1)
        rows.append((cols[0], n, uname, cols))
    return rows


def ipmi_has_duplicates(text):
    return any(n > 0 for _, n, _, _ in _ipmi_rows(text))


def _valid_limit(raw):
    v = _float_or_none(raw)
    return v if v is not None and v > 0 else None


def parse_ipmi_sensors(text, entities=None):
    """Parse `ipmitool sensor` output (temperatures, fans, voltages). Pure.
    'na' values and zero limits are skipped. Duplicate sensor names get -2, -3
    suffixes. PSU state comes from `sdr type "Power Supply"`."""
    metrics = []
    for orig, occurrence, name, cols in _ipmi_rows(text):
        value, unit = cols[1], cols[2].lower()
        lcr, lnc, unc, ucr = cols[5], cols[6], cols[7], cols[8]
        attrs = {"sensor": name}

        def limits(metric, htype, pairs):
            for limit_type, raw in pairs:
                lv = _valid_limit(raw)
                if lv is not None:
                    metrics.append(Metric(metric, lv, htype, name,
                                          {"sensor": name, "limit_type": limit_type}))

        if unit == "degrees c":
            v = _float_or_none(value)
            if v is None:
                continue
            htype = ipmi_temp_type(orig)
            if htype == "board" and entities:
                types = entities.get(orig) or []
                if occurrence < len(types):
                    htype = types[occurrence]
            metrics.append(Metric("hw.temperature", v, htype, name, attrs))
            limits("hw.temperature.limit", htype, (("high", unc), ("critical", ucr)))
        elif unit == "rpm":
            v = _float_or_none(value)
            if v is None:
                continue
            metrics.append(Metric("hw.fan.speed", v, "fan", name, attrs))
            limits("hw.fan.speed.limit", "fan", (("low.critical", lcr),))
        elif unit == "volts":
            v = _float_or_none(value)
            if v is None:
                continue
            metrics.append(Metric("hw.voltage", v, "voltage", name, attrs))
            limits("hw.voltage.limit", "voltage", (("low.critical", lcr), ("high.critical", ucr),
                                                    ("low", lnc), ("high", unc)))
    return metrics


PSU_FAIL_RE = re.compile(
    r"failure detected|predictive failure|power supply ac lost|ac lost or out-of-range|config error|input lost|input out-of-range|fan failure|power supply failure",
    re.I)


def parse_psu_sdr(text):
    """Parse `ipmitool sdr type "Power Supply"` (name | id | status | entity | event
    text). Returns hw.power_supply.status metrics: 0 on failure or lost
    redundancy, 1 when present and healthy or fully redundant. Empty slots and
    unreadable sensors are skipped. Pure."""
    metrics = []
    for line in text.splitlines():
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 5 or not cols[0]:
            continue
        name, event = cols[0], cols[4].lower()
        if not event or "not detected" in event:
            continue
        if PSU_FAIL_RE.search(event) or "redundancy lost" in event or "non-redundant" in event:
            ok = 0
        elif "fully redundant" in event or "presence detected" in event:
            ok = 1
        else:
            continue
        metrics.append(Metric("hw.power_supply.status", ok, "power_supply", name, {"sensor": name}))
    return metrics


def collect_ipmi(ctx):
    rc, out = ctx.run(["ipmitool", "sensor"])
    if rc != 0 and "|" not in out:
        raise CollectorUnavailable("ipmitool sensor failed (no BMC device?)")
    entities = None
    if ipmi_has_duplicates(out):
        try:  # entity ids tell apart the several sensors that are all called "Temp"
            _, elist = ctx.run(["ipmitool", "sdr", "elist", "full"])
            entities = parse_sdr_entities(elist)
        except CollectorUnavailable:
            raise
        except Exception as e:
            log.warning("ipmi: sdr elist failed: %s", e)
    metrics = parse_ipmi_sensors(out, entities)
    try:
        rc, sdr = ctx.run(["ipmitool", "sdr", "type", "Power Supply"])
        if "|" in sdr:
            metrics.extend(parse_psu_sdr(sdr))
    except CollectorUnavailable:
        raise
    except Exception as e:
        log.warning("ipmi: power supply query failed: %s", e)
    return metrics


# ---------------------------------------------------------------------------
# sel (BMC event log)
# ---------------------------------------------------------------------------

SEL_CRITICAL_RE = re.compile(r"uncorrectable|failure|predictive failure", re.I)


def parse_sel(text):
    """Parse `ipmitool sel elist` into [(id, timestamp, sensor, event, direction)]."""
    entries = []
    for line in text.splitlines():
        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 5:
            continue
        try:
            rec_id = int(cols[0], 16)
        except ValueError:
            continue
        direction = cols[5] if len(cols) > 5 else ""
        entries.append((rec_id, (cols[1] + " " + cols[2]).strip(), cols[3], cols[4], direction))
    return entries


def classify_sel(sensor, event):
    text = (sensor + " " + event).lower()
    if re.search(r"power supply|\bps\d|\bpsu|redundancy|voltage|\bvrm", text):
        return "power"
    if re.search(r"temperature|\btemp\b|thermal|overheat", text):
        return "thermal"
    if re.search(r"memory|dimm|\becc\b|correctable", text):
        return "memory"
    if re.search(r"drive|disk|\bhdd\b|raid", text):
        return "disk"
    if re.search(r"processor|\bcpu\b|ierr|\bmce\b", text):
        return "cpu"
    if re.search(r"pci|critical interrupt", text):
        return "pcie"
    return "other"


def _state_path(ctx, name):
    return os.path.join(ctx.config.state_dir, name)


def _write_state(ctx, name, value):
    try:
        os.makedirs(ctx.config.state_dir, exist_ok=True)
        tmp = _state_path(ctx, name) + ".tmp"
        with open(tmp, "w") as f:
            f.write(str(value))
        os.replace(tmp, _state_path(ctx, name))
    except OSError as e:
        log.warning("cannot write state %s: %s", name, e)


def collect_sel(ctx):
    rc, out = ctx.run(["ipmitool", "sel", "elist"])
    if rc != 0 and "|" not in out:
        raise CollectorUnavailable("ipmitool sel elist failed (no BMC device?)")
    entries = parse_sel(out)
    max_id = max([e[0] for e in entries]) if entries else 0
    last = read_int(_state_path(ctx, "sel_last_id"))
    if last is None:
        # First run: remember where we are, never replay history.
        _write_state(ctx, "sel_last_id", max_id)
        return []
    if max_id < last:
        last = 0  # the log was cleared and ids restarted
    for rec_id, ts, sensor, event, direction in entries:
        if rec_id <= last:
            continue
        deasserted = direction.lower() == "deasserted"
        show_dir = direction and direction.lower() not in event.lower()
        message = "BMC SEL: %s | %s%s" % (sensor, event, (" | " + direction) if show_dir else "")
        if deasserted:
            level = "info"  # the condition cleared, not a new problem
        else:
            level = "critical" if SEL_CRITICAL_RE.search(event) else "warn"
        ctx.events.append(make_event(
            ctx.config.hostname, message, level, "sel", classify_sel(sensor, event),
            extra={"hw.sel.id": rec_id, "hw.sel.timestamp": ts,
                   "hw.sel.direction": "deasserted" if deasserted else "asserted"},
        ))
    _write_state(ctx, "sel_last_id", max(max_id, last))
    return []


# ---------------------------------------------------------------------------
# net
# ---------------------------------------------------------------------------

NET_STATS = (
    ("rx_errors", "receive", "errors"),
    ("tx_errors", "transmit", "errors"),
    ("rx_crc_errors", "receive", "crc"),
    ("rx_dropped", "receive", "dropped"),
    ("tx_dropped", "transmit", "dropped"),
)


def collect_net(ctx):
    base = ctx.path("/sys/class/net")
    if not os.path.isdir(base):
        raise CollectorUnavailable("no /sys/class/net")
    metrics = []
    for iface in _list_dir(base):
        n_dir = base + "/" + iface
        if not os.path.exists(n_dir + "/device"):
            continue  # virtual interface (lo, docker0, veth, bridges...)
        for fname, direction, etype in NET_STATS:
            v = read_int(n_dir + "/statistics/" + fname)
            if v is not None:
                metrics.append(Metric("hw.network.errors", v, "network", iface,
                                      {"direction": direction, "error_type": etype}))
        cc = read_int(n_dir + "/carrier_changes")
        if cc is not None:
            metrics.append(Metric("hw.network.carrier_changes", cc, "network", iface, {}))
        state = read_str(n_dir + "/operstate")
        if state in ("up", "down", "lowerlayerdown", "dormant", "notpresent"):
            attrs = {}
            speed = read_int(n_dir + "/speed")
            if speed is not None and speed > 0:
                attrs["speed_mbps"] = speed
            metrics.append(Metric("hw.network.up", 1 if state == "up" else 0, "network", iface, attrs))
    return metrics


# ---------------------------------------------------------------------------
# host info and memory size (always on, no status metric)
# ---------------------------------------------------------------------------

VM_VENDOR_RE = re.compile(
    r"qemu|kvm|vmware|virtualbox|innotek|xen|bochs|amazon ec2|google compute|"
    r"hyper-v|virtual machine|parallels|bhyve", re.I)


def collect_host(ctx):
    vendor = read_str(ctx.path("/sys/class/dmi/id/sys_vendor")) or ""
    model = read_str(ctx.path("/sys/class/dmi/id/product_name")) or ""
    kernel = read_str(ctx.path("/proc/sys/kernel/osrelease")) or ""
    cpuinfo = read_text(ctx.path("/proc/cpuinfo")) or ""
    virtual = bool(re.search(r"^flags\s*:.*\bhypervisor\b", cpuinfo, re.M))
    if not virtual and VM_VENDOR_RE.search(vendor + " " + model):
        virtual = True
    if not virtual:
        try:
            _, out = ctx.run(["systemd-detect-virt", "--vm"], timeout=10)
            virtual = out.strip() not in ("", "none")
        except (CollectorUnavailable, RuntimeError):
            pass
    attrs = {"hw.virtual": virtual, "agent.version": AGENT_VERSION}
    if vendor:
        attrs["hw.vendor"] = vendor
    if model:
        attrs["hw.model"] = model
    if kernel:
        attrs["os.kernel"] = kernel
    metrics = [Metric("hw.host.info", 1, "host", "host", attrs)]
    meminfo = read_text(ctx.path("/proc/meminfo")) or ""
    m = re.search(r"^MemTotal:\s+(\d+)\s*kB", meminfo, re.M)
    if m:
        metrics.append(Metric("hw.memory.size", int(m.group(1)) * 1024, "memory", "system", {}))
    return metrics


# ---------------------------------------------------------------------------
# kmsg
# ---------------------------------------------------------------------------

# Order matters: first match wins.
KMSG_PATTERNS = (
    ("pcie", re.compile(r"AER: (Corrected|Uncorrected|Multiple)|PCIe Bus Error", re.I)),
    ("thermal", re.compile(r"temperature above threshold|cpu clock throttled|"
                           r"thermal.*critical", re.I)),
    ("network", re.compile(r"NIC Link is Down|Detected Tx Unit Hang|link is not ready|NETDEV WATCHDOG", re.I)),
    ("disk", re.compile(
        r"I/O error, dev|hard resetting link|SATA link down|failed command: (READ|WRITE) (FPDMA|DMA)|"
        r"failed command: FLUSH|exception Emask|Unrecovered read error|will reset|probe failure|"
        r"\bUNC\b|nvme\d*.*(I/O .*timeout|controller is down|timeout)|Medium Error|Buffer I/O error",
        re.I)),
    ("power", re.compile(r"Power supply.*(fail|fault|lost|critical)|redundancy lost|\bPSU\b.*(fail|fault)", re.I)),
    ("cpu", re.compile(r"Machine Check Exception|mce: \[Hardware Error\]: CPU \d+: Machine Check",
                       re.I)),
    ("memory", re.compile(
        r"EDAC.*\b(CE|UE)\b|EDAC.*\b(corrected|uncorrected|errors?)\b|Hardware Error|"
        r"Machine check events logged|mce: \[Hardware Error\]", re.I)),
)


def classify_kmsg(message):
    """Return hw.event.type for a hardware kernel line, or None to drop it."""
    for etype, rx in KMSG_PATTERNS:
        if rx.search(message):
            return etype
    return None


def parse_kmsg_record(raw):
    """Parse `prio,seq,ts_us,flags;message` into (priority, ts_us, message) or None."""
    if not raw or raw[:1] == " ":
        return None  # continuation (key=value dictionary) line
    head, sep, message = raw.partition(";")
    if not sep:
        return None
    fields = head.split(",")
    if len(fields) < 3:
        return None
    try:
        prio = int(fields[0]) & 7
        ts = int(fields[2])
    except ValueError:
        return None
    return prio, ts, message.rstrip("\n")


def kmsg_level(prio):
    """Hardware lines are always at least a warning, whatever the kernel says."""
    if prio <= 2:
        return "critical"
    if prio == 3:
        return "error"
    return "warn"


def iso_time(epoch=None):
    dt = datetime.fromtimestamp(time.time() if epoch is None else epoch, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (dt.microsecond // 1000)


def make_event(hostname, message, level, source, etype, extra=None, when=None):
    # `hostname` is repeated in metadata: the batch endpoint validates against a
    # schema that drops unknown top-level keys, metadata.hostname is always kept.
    meta = {
        "hw.event.source": source,
        "hw.event.type": etype,
        "host.name": hostname,
        "hostname": hostname,
    }
    if extra:
        meta.update(extra)
    return {
        "time": iso_time(when),
        "service": EVENT_SERVICE,
        "level": level,
        "message": message,
        "hostname": hostname,
        "metadata": meta,
    }


class KmsgReader(object):
    """Background thread: tail /dev/kmsg from the end and forward hardware lines."""

    FLUSH_SECONDS = 5

    def __init__(self, config, on_events):
        self.config = config
        self.on_events = on_events
        self.stop = threading.Event()
        self.running = False
        self.fd = None
        self.thread = None
        self._boot = self._boot_epoch()

    def _boot_epoch(self):
        up = read_text(self.config.path("/proc/uptime"))
        try:
            return time.time() - float(up.split()[0])
        except (AttributeError, IndexError, ValueError):
            return None

    def start(self):
        """Open the device now so the collector status is truthful."""
        try:
            self.fd = os.open(self.config.kmsg_path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
            os.lseek(self.fd, 0, os.SEEK_END)
        except OSError as e:
            log.info("kmsg unavailable: %s", e)
            return False
        self.running = True
        self.thread = threading.Thread(target=self._run, name="kmsg", daemon=True)
        self.thread.start()
        return True

    def close(self):
        self.stop.set()

    def event_from_line(self, raw):
        rec = parse_kmsg_record(raw)
        if rec is None:
            return None
        prio, ts, message = rec
        etype = classify_kmsg(message)
        if etype is None:
            return None
        when = (self._boot + ts / 1e6) if self._boot else None
        return make_event(self.config.hostname, message, kmsg_level(prio), "kmsg", etype, when=when)

    def _run(self):
        batch = []
        last_flush = time.time()
        try:
            while not self.stop.is_set():
                try:
                    ready, _, _ = select.select([self.fd], [], [], 1.0)
                    while ready:
                        try:
                            data = os.read(self.fd, 8192)
                        except BlockingIOError:
                            break
                        except OSError as e:
                            if e.errno == 32:  # EPIPE: ring buffer overrun, keep going
                                continue
                            raise
                        if not data:
                            break
                        ev = self.event_from_line(data.decode("utf-8", "replace"))
                        if ev:
                            batch.append(ev)
                except Exception as e:  # never let the thread die silently
                    log.error("kmsg reader error: %s", e)
                    time.sleep(5)
                if batch and (time.time() - last_flush >= self.FLUSH_SECONDS or len(batch) >= 50):
                    self._flush(batch)
                    batch = []
                    last_flush = time.time()
        finally:
            if batch:
                self._flush(batch)
            self.running = False
            try:
                os.close(self.fd)
            except OSError:
                pass

    def _flush(self, batch):
        try:
            self.on_events(list(batch))
        except Exception as e:
            log.error("kmsg flush failed: %s", e)


def collect_kmsg_status(ctx):
    """kmsg produces events asynchronously; this collector only reports readiness."""
    if ctx.kmsg is not None:
        if ctx.kmsg.running:
            return []
        raise CollectorUnavailable("kmsg reader not running")
    try:  # --once or no reader: check that the device can be opened
        fd = os.open(ctx.config.kmsg_path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        os.close(fd)
    except OSError as e:
        raise CollectorUnavailable("cannot open %s: %s" % (ctx.config.kmsg_path, e))
    return []


COLLECTORS = {
    "smart": collect_smart,
    "edac": collect_edac,
    "hwmon": collect_hwmon,
    "thermal": collect_thermal,
    "ipmi": collect_ipmi,
    "sel": collect_sel,
    "net": collect_net,
    "kmsg": collect_kmsg_status,
}


def run_collectors(ctx, names=None):
    """Run each collector in isolation. Returns all metrics including the
    per-collector hw.agent.collector.status (1 ok, 0 absent or failed)."""
    names = ctx.config.collectors if names is None else names
    metrics = []
    try:
        metrics.extend(collect_host(ctx))
    except Exception as e:
        log.error("host info failed: %s", e)
    for name in names:
        fn = COLLECTORS.get(name)
        if fn is None:
            continue
        status = 1
        try:
            metrics.extend(fn(ctx))
            ctx._unavailable_logged.discard(name)
        except CollectorUnavailable as e:
            status = 0
            if name not in ctx._unavailable_logged:
                ctx._unavailable_logged.add(name)
                log.info("collector %s unavailable: %s", name, e)
        except Exception as e:
            status = 0
            log.error("collector %s failed: %s", name, e)
        metrics.append(Metric("hw.agent.collector.status", status, "agent", name, {"collector": name}))
    return metrics


# ---------------------------------------------------------------------------
# OTLP encoding
# ---------------------------------------------------------------------------

def _kv(key, value):
    if isinstance(value, bool):
        v = {"boolValue": value}
    elif isinstance(value, int):
        v = {"intValue": str(value)}
    elif isinstance(value, float):
        v = {"doubleValue": value}
    else:
        v = {"stringValue": str(value)}
    return {"key": key, "value": v}


def build_otlp_metrics(metrics, hostname, now_ns=None):
    """Build an ExportMetricsServiceRequest (JSON form) made of gauges."""
    now_ns = int(time.time() * 1e9) if now_ns is None else now_ns
    by_name = {}
    order = []
    for m in metrics:
        if m.name not in by_name:
            by_name[m.name] = []
            order.append(m.name)
        attrs = [_kv("host.name", hostname), _kv("hw.type", m.hw_type), _kv("hw.id", m.hw_id)]
        for k, v in m.attrs.items():
            attrs.append(_kv(k, v))
        by_name[m.name].append({
            "timeUnixNano": str(now_ns),
            "asDouble": float(m.value),
            "attributes": attrs,
        })
    otlp_metrics = [
        {"name": n, "unit": UNITS.get(n, "1"), "gauge": {"dataPoints": by_name[n]}}
        for n in order
    ]
    return {
        "resourceMetrics": [{
            "resource": {"attributes": [_kv("service.name", SERVICE_NAME), _kv("host.name", hostname)]},
            "scopeMetrics": [{
                "scope": {"name": SERVICE_NAME, "version": AGENT_VERSION},
                "metrics": otlp_metrics,
            }],
        }]
    }


# ---------------------------------------------------------------------------
# Sender
# ---------------------------------------------------------------------------

def _chunks(items, n):
    for i in range(0, len(items), n):
        yield items[i:i + n]


class Sender(object):
    MAX_PENDING_LOGS = 5000
    BATCH = 500

    def __init__(self, config, sleep=time.sleep):
        self.config = config
        self.sleep = sleep
        self._lock = threading.Lock()
        self._pending_logs = []

    def _post(self, path, payload, retries=3):
        """POST JSON. Returns True on success, False when dropped (4xx),
        None when a retriable failure persisted after all attempts."""
        body = json.dumps(payload).encode("utf-8")
        url = self.config.url + path
        delay = 1
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, data=body, method="POST", headers={
                "Content-Type": "application/json",
                "X-API-Key": self.config.api_key,
                "User-Agent": "%s/%s" % (SERVICE_NAME, AGENT_VERSION),
            })
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    resp.read()
                return True
            except urllib.error.HTTPError as e:
                if e.code < 500 and e.code not in (408, 429):
                    detail = ""
                    try:
                        detail = e.read(200).decode("utf-8", "replace")
                    except Exception:
                        pass
                    log.error("%s rejected with HTTP %d, dropping batch: %s", path, e.code, detail)
                    return False
                err = "HTTP %d" % e.code
            except Exception as e:
                err = str(e)
            if attempt < retries:
                log.warning("%s failed (%s), retry in %ds", path, err, delay)
                self.sleep(delay)
                delay *= 2
            else:
                log.error("%s failed (%s), giving up after %d attempts", path, err, retries + 1)
        return None

    def send_metrics(self, payload):
        if self.config.dry_run:
            print(json.dumps(payload, indent=2))
            return True
        return self._post("/v1/otlp/metrics", payload) is True

    def send_logs(self, events):
        """Queue events and try to deliver everything pending. A retriable failure
        keeps the batch for the next call (bounded), a 4xx drops it."""
        with self._lock:
            self._pending_logs.extend(events)
            if len(self._pending_logs) > self.MAX_PENDING_LOGS:
                dropped = len(self._pending_logs) - self.MAX_PENDING_LOGS
                self._pending_logs = self._pending_logs[dropped:]
                log.warning("log buffer full, dropped %d oldest events", dropped)
            if self.config.dry_run:
                for chunk in _chunks(self._pending_logs, self.BATCH):
                    print(json.dumps({"logs": chunk}, indent=2))
                self._pending_logs = []
                return True
            ok = True
            while self._pending_logs:
                chunk = self._pending_logs[:self.BATCH]
                result = self._post("/api/v1/ingest", {"logs": chunk})
                if result is None:
                    return False  # keep the rest for the next attempt
                del self._pending_logs[:len(chunk)]
                if result is False:
                    ok = False
            return ok

    @property
    def pending(self):
        with self._lock:
            return len(self._pending_logs)


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

def collect_once(ctx, sender):
    """One collection cycle. Returns True when delivery succeeded."""
    ctx.events = []
    metrics = run_collectors(ctx)
    ok = sender.send_metrics(build_otlp_metrics(metrics, ctx.config.hostname))
    if ctx.events or sender.pending:
        ok = sender.send_logs(ctx.events) and ok
    return ok


def main(argv=None):
    parser = argparse.ArgumentParser(description="LogTide hardware agent")
    parser.add_argument("--once", action="store_true", help="collect once, send, and exit")
    parser.add_argument("--version", action="version", version=AGENT_VERSION)
    args = parser.parse_args(argv)

    logging.basicConfig(stream=sys.stderr, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    config = Config()
    if not config.dry_run and not config.url:
        log.error("LOGTIDE_URL is not set")
        return 2
    if not config.dry_run and not config.api_key:
        log.error("LOGTIDE_API_KEY is not set")
        return 2

    ctx = Context(config)
    sender = Sender(config)
    log.info("starting %s %s host=%s interval=%ss collectors=%s%s",
             SERVICE_NAME, AGENT_VERSION, config.hostname, config.interval,
             ",".join(config.collectors), " (dry run)" if config.dry_run else "")

    if args.once:
        return 0 if collect_once(ctx, sender) else 1

    if "kmsg" in config.collectors:
        reader = KmsgReader(config, sender.send_logs)
        if reader.start():
            ctx.kmsg = reader

    stop = threading.Event()

    def handle(signum, frame):
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handle)
        except (ValueError, OSError):
            pass

    while not stop.is_set():
        started = time.time()
        try:
            collect_once(ctx, sender)
        except Exception as e:  # the loop must survive anything
            log.error("collection cycle failed: %s", e)
        stop.wait(max(1.0, config.interval - (time.time() - started)))

    if ctx.kmsg:
        ctx.kmsg.close()
    log.info("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
