import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import logtide_hw_agent as agent  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, "fixtures", name), "r", encoding="utf-8") as f:
        return f.read()


def fixture_json(name):
    return json.loads(fixture(name))


def write(root, rel, content):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(str(content))


def by(metrics, name, hw_id=None, **attrs):
    out = []
    for m in metrics:
        if m.name != name or (hw_id is not None and m.hw_id != hw_id):
            continue
        if all(m.attrs.get(k) == v for k, v in attrs.items()):
            out.append(m)
    return out


def one(metrics, name, **attrs):
    found = by(metrics, name, **attrs)
    assert len(found) == 1, "expected one %s %s, got %r" % (name, attrs, found)
    return found[0]


class TmpRootCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="hwagent-")
        self.state = tempfile.mkdtemp(prefix="hwagent-state-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.addCleanup(shutil.rmtree, self.state, True)
        env = {
            "HOST_ROOT": self.root,
            "LOGTIDE_HW_STATE_DIR": self.state,
            "LOGTIDE_HOSTNAME": "testhost",
            "LOGTIDE_URL": "http://backend:8080",
            "LOGTIDE_API_KEY": "lp_test",
            "LOGTIDE_HW_KMSG_PATH": os.path.join(self.root, "no-such-kmsg"),
        }
        self.config = agent.Config(env)
        self.ctx = agent.Context(self.config)


class SmartParsingTest(unittest.TestCase):
    def test_ata_healthy(self):
        m = agent.parse_smart_device(fixture_json("smart_ata_healthy.json"))
        self.assertEqual(one(m, "hw.physical_disk.smart_status").value, 1)
        status = one(m, "hw.physical_disk.smart_status")
        self.assertEqual(status.hw_type, "physical_disk")
        self.assertEqual(status.hw_id, "WD-WCC7K0000001")
        self.assertEqual(status.attrs["protocol"], "ata")
        self.assertEqual(status.attrs["model"], "WDC WD40EFRX-68N32N0")
        self.assertEqual(status.attrs["serial"], "WD-WCC7K0000001")
        self.assertEqual(status.attrs["device"], "sda")
        labels = sorted(x.attrs["smart_attribute"] for x in by(m, "hw.physical_disk.smart"))
        self.assertEqual(labels, sorted([
            "reallocated_sector_count", "current_pending_sector", "offline_uncorrectable",
            "reported_uncorrect", "udma_crc_error_count", "command_timeout",
            "reallocated_event_count", "power_on_hours"]))
        self.assertEqual(one(m, "hw.physical_disk.smart", smart_attribute="power_on_hours").value, 12000)
        self.assertEqual(one(m, "hw.temperature").value, 34)
        self.assertEqual(one(m, "hw.temperature").attrs["sensor"], "smart")
        self.assertEqual(by(m, "hw.physical_disk.endurance_utilization"), [])

    def test_ata_bad(self):
        m = agent.parse_smart_device(fixture_json("smart_ata_bad.json"))
        self.assertEqual(one(m, "hw.physical_disk.smart_status").value, 0)
        self.assertEqual(one(m, "hw.physical_disk.smart", smart_attribute="reallocated_sector_count").value, 24)
        self.assertEqual(one(m, "hw.physical_disk.smart", smart_attribute="current_pending_sector").value, 3)
        self.assertEqual(one(m, "hw.physical_disk.smart", smart_attribute="offline_uncorrectable").value, 2)
        self.assertEqual(one(m, "hw.physical_disk.smart", smart_attribute="udma_crc_error_count").value, 7)
        # attribute 177 normalized value 72 means 28% used
        self.assertEqual(one(m, "hw.physical_disk.endurance_utilization").value, 28)

    def test_nvme_healthy(self):
        m = agent.parse_smart_device(fixture_json("smart_nvme_healthy.json"))
        self.assertEqual(one(m, "hw.physical_disk.smart_status").attrs["protocol"], "nvme")
        self.assertEqual(one(m, "hw.physical_disk.smart_status").hw_id, "S5GXNX0R000003")
        self.assertEqual(one(m, "hw.physical_disk.smart_status").attrs["device"], "nvme0")
        self.assertEqual(one(m, "hw.physical_disk.critical_warning").value, 0)
        self.assertEqual(one(m, "hw.physical_disk.available_spare").value, 100)
        self.assertEqual(one(m, "hw.physical_disk.available_spare_threshold").value, 10)
        self.assertEqual(one(m, "hw.physical_disk.endurance_utilization").value, 3)
        self.assertEqual(one(m, "hw.physical_disk.media_errors").value, 0)
        self.assertEqual(one(m, "hw.physical_disk.smart", smart_attribute="power_on_hours").value, 2500)

    def test_nvme_critical_warning(self):
        m = agent.parse_smart_device(fixture_json("smart_nvme_critical.json"))
        self.assertEqual(one(m, "hw.physical_disk.smart_status").value, 0)
        self.assertEqual(one(m, "hw.physical_disk.critical_warning").value, 4)
        self.assertEqual(one(m, "hw.physical_disk.media_errors").value, 12)
        self.assertEqual(one(m, "hw.physical_disk.endurance_utilization").value, 97)
        self.assertEqual(one(m, "hw.temperature").value, 72)

    def test_every_disk_metric_uses_the_same_identity(self):
        for name in ("smart_ata_healthy.json", "smart_nvme_critical.json"):
            data = fixture_json(name)
            serial = data["serial_number"]
            m = agent.parse_smart_device(data)
            self.assertTrue(m)
            self.assertEqual(set(x.hw_id for x in m), {serial})
            self.assertEqual(set(x.attrs["device"] for x in m), {os.path.basename(data["device"]["name"])})

    def test_identity_sanitizes_and_falls_back(self):
        data = fixture_json("smart_ata_healthy.json")
        data["serial_number"] = "  WD WCC 7K  "
        self.assertEqual(agent.disk_ident(data), "WDWCC7K")
        del data["serial_number"]
        self.assertEqual(agent.disk_ident(data, {"sda": "ata-WDC_WD40EFRX_X"}), "ata-WDC_WD40EFRX_X")
        self.assertEqual(agent.disk_ident(data), "sda")
        self.assertEqual(agent.disk_ident(data, {"sdb": "x"}), "sda")

    def test_no_smart_support_is_skipped(self):
        self.assertEqual(agent.parse_smart_device(fixture_json("smart_unsupported.json")), [])

    def test_empty_document(self):
        self.assertEqual(agent.parse_smart_device({}), [])
        self.assertEqual(agent.parse_smart_device({"device": {"name": "/dev/sdz"}}), [])


class SmartCollectorTest(TmpRootCase):
    def test_runs_scan_then_each_device(self):
        calls = []
        docs = {
            "/dev/sda": fixture("smart_ata_healthy.json"),
            "/dev/nvme0": fixture("smart_nvme_healthy.json"),
            "/dev/sdc": fixture("smart_unsupported.json"),
        }

        def run(args, timeout=60):
            calls.append(args)
            if "--scan-open" in args:
                return 0, fixture("smartctl_scan.json")
            return 4, docs[args[3]]  # non-zero exit bitmask must be tolerated

        self.ctx.run = run
        with mock.patch.object(agent, "read_by_id_map", return_value={}):
            metrics = agent.collect_smart(self.ctx)
        self.assertEqual(calls[1], ["smartctl", "-a", "-j", "/dev/sda", "-d", "sat"])
        self.assertEqual(calls[2], ["smartctl", "-a", "-j", "/dev/nvme0", "-d", "nvme"])
        ids = sorted(set(m.hw_id for m in metrics))
        self.assertEqual(ids, ["S5GXNX0R000003", "WD-WCC7K0000001"])

    def test_smartctl_missing_is_unavailable(self):
        def run(args, timeout=60):
            raise agent.CollectorUnavailable("smartctl not installed")

        self.ctx.run = run
        with self.assertRaises(agent.CollectorUnavailable):
            agent.collect_smart(self.ctx)


class EdacTest(TmpRootCase):
    def test_controller_and_dimm_counts(self):
        base = "sys/devices/system/edac/mc/mc0"
        write(self.root, base + "/ce_count", "5\n")
        write(self.root, base + "/ue_count", "0\n")
        write(self.root, base + "/dimm0/dimm_ce_count", "5\n")
        write(self.root, base + "/dimm0/dimm_ue_count", "0\n")
        write(self.root, base + "/dimm0/dimm_label", "CPU_SrcID#0_Chan#0_DIMM#0\n")
        write(self.root, base + "/dimm1/dimm_ce_count", "0\n")
        write(self.root, base + "/dimm1/dimm_ue_count", "0\n")
        write(self.root, base + "/dimm1/dimm_label", "\n")
        m = agent.collect_edac(self.ctx)
        mc = one(m, "hw.memory.errors", error_type="corrected", scope="controller")
        self.assertEqual((mc.hw_id, mc.value, mc.hw_type), ("mc0", 5, "memory"))
        dimm = one(m, "hw.memory.errors", error_type="corrected", hw_id="mc0/dimm0")
        self.assertEqual(dimm.value, 5)
        self.assertEqual(dimm.attrs["dimm_label"], "CPU_SrcID#0_Chan#0_DIMM#0")
        self.assertEqual((dimm.attrs["scope"], dimm.attrs["controller"]), ("dimm", "mc0"))
        self.assertEqual(mc.attrs["controller"], "mc0")
        # no label: the id is still mc/dimm, without a dimm_label attribute
        d1 = one(m, "hw.memory.errors", error_type="corrected", hw_id="mc0/dimm1")
        self.assertNotIn("dimm_label", d1.attrs)

    def test_absent(self):
        with self.assertRaises(agent.CollectorUnavailable):
            agent.collect_edac(self.ctx)


class HwmonTest(TmpRootCase):
    def setUp(self):
        TmpRootCase.setUp(self)
        self.ctx.smartctl_available = lambda: False

    def test_conversions_and_types(self):
        write(self.root, "sys/class/hwmon/hwmon0/name", "coretemp\n")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "45500\n")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_max", "100000\n")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_crit", "105000\n")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_label", "Package id 0\n")
        write(self.root, "sys/class/hwmon/hwmon1/name", "nvme\n")
        write(self.root, "sys/class/hwmon/hwmon1/temp1_input", "38850\n")
        write(self.root, "sys/class/hwmon/hwmon2/name", "nct6798\n")
        write(self.root, "sys/class/hwmon/hwmon2/fan1_input", "1200\n")
        write(self.root, "sys/class/hwmon/hwmon2/in0_input", "1056\n")
        write(self.root, "sys/class/hwmon/hwmon2/in0_min", "900\n")
        write(self.root, "sys/class/hwmon/hwmon2/in0_max", "1300\n")
        write(self.root, "sys/class/hwmon/hwmon2/in0_label", "Vcore\n")
        write(self.root, "sys/class/hwmon/hwmon2/temp2_input", "30000\n")
        m = agent.collect_hwmon(self.ctx)
        t = one(m, "hw.temperature", sensor="Package id 0")
        self.assertEqual((t.value, t.hw_type, t.hw_id), (45.5, "cpu", "coretemp"))
        self.assertEqual(one(m, "hw.temperature.limit", limit_type="high", sensor="Package id 0").value, 100.0)
        self.assertEqual(one(m, "hw.temperature.limit", limit_type="critical", sensor="Package id 0").value, 105.0)
        nvme = one(m, "hw.temperature", sensor="hwmon", hw_id="nvme")
        self.assertEqual((nvme.value, nvme.hw_type), (38.85, "physical_disk"))
        self.assertEqual(one(m, "hw.temperature", hw_id="nct6798").hw_type, "board")
        fan = one(m, "hw.fan.speed")
        self.assertEqual((fan.value, fan.hw_type, fan.attrs["sensor"]), (1200, "fan", "fan1"))
        v = one(m, "hw.voltage")
        self.assertEqual((v.value, v.attrs["sensor"], v.hw_type), (1.056, "Vcore", "voltage"))
        self.assertEqual(one(m, "hw.voltage.limit", limit_type="low").value, 0.9)
        self.assertEqual(one(m, "hw.voltage.limit", limit_type="high").value, 1.3)

    def test_zero_limits_are_never_emitted(self):
        write(self.root, "sys/class/hwmon/hwmon0/name", "nct6798")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "30000")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_max", "0")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_crit", "0")
        write(self.root, "sys/class/hwmon/hwmon0/in0_input", "1000")
        write(self.root, "sys/class/hwmon/hwmon0/in0_min", "0")
        write(self.root, "sys/class/hwmon/hwmon0/in0_max", "0")
        m = agent.collect_hwmon(self.ctx)
        self.assertEqual(by(m, "hw.temperature.limit"), [])
        self.assertEqual(by(m, "hw.voltage.limit"), [])
        self.assertEqual(len(m), 2)

    def test_disk_chips_skipped_when_smart_covers_them(self):
        write(self.root, "sys/class/hwmon/hwmon0/name", "nvme")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "30000")
        write(self.root, "sys/class/hwmon/hwmon1/name", "drivetemp")
        write(self.root, "sys/class/hwmon/hwmon1/temp1_input", "31000")
        write(self.root, "sys/class/hwmon/hwmon2/name", "coretemp")
        write(self.root, "sys/class/hwmon/hwmon2/temp1_input", "40000")
        self.ctx.smartctl_available = lambda: True
        self.assertEqual([m.hw_id for m in agent.collect_hwmon(self.ctx)], ["coretemp"])
        # smart collector disabled: the disk chips come back
        self.config.collectors = ["hwmon"]
        self.assertEqual(len(agent.collect_hwmon(self.ctx)), 3)

    def test_chip_identity_from_device_link(self):
        write(self.root, "sys/class/hwmon/hwmon0/name", "coretemp")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "40000")
        with mock.patch("os.path.islink", lambda p: p.endswith("hwmon0/device")), \
                mock.patch("os.path.realpath", lambda p: "/sys/devices/platform/coretemp.0"):
            m = agent.collect_hwmon(self.ctx)
        self.assertEqual(m[0].hw_id, "coretemp-coretemp.0")

    def test_duplicate_chip_names_get_suffix(self):
        for i in (3, 4):
            write(self.root, "sys/class/hwmon/hwmon%d/name" % i, "nvme\n")
            write(self.root, "sys/class/hwmon/hwmon%d/temp1_input" % i, "30000\n")
        ids = sorted(m.hw_id for m in agent.collect_hwmon(self.ctx))
        self.assertEqual(ids, ["nvme-3", "nvme-4"])

    def test_chip_type_mapping(self):
        self.assertEqual(agent.hwmon_type("k10temp"), "cpu")
        self.assertEqual(agent.hwmon_type("zenpower"), "cpu")
        self.assertEqual(agent.hwmon_type("drivetemp"), "physical_disk")
        self.assertEqual(agent.hwmon_type("acpitz"), "board")

    def test_absent(self):
        with self.assertRaises(agent.CollectorUnavailable):
            agent.collect_hwmon(self.ctx)


class ThermalTest(TmpRootCase):
    def test_aggregates_per_package(self):
        cpu = "sys/devices/system/cpu/cpu%d/"
        for i, (pkg, core, package) in enumerate([(0, 1, 7), (0, 2, 7), (1, 4, 3), (1, 0, 3)]):
            write(self.root, cpu % i + "topology/physical_package_id", pkg)
            write(self.root, cpu % i + "thermal_throttle/core_throttle_count", core)
            write(self.root, cpu % i + "thermal_throttle/package_throttle_count", package)
        m = agent.collect_thermal(self.ctx)
        self.assertEqual(one(m, "hw.cpu.throttle_count", hw_id="package0", throttle_type="core").value, 2)
        self.assertEqual(one(m, "hw.cpu.throttle_count", hw_id="package0", throttle_type="package").value, 7)
        self.assertEqual(one(m, "hw.cpu.throttle_count", hw_id="package1", throttle_type="core").value, 4)
        self.assertEqual(one(m, "hw.cpu.throttle_count", hw_id="package1", throttle_type="package").value, 3)

    def test_absent(self):
        write(self.root, "sys/devices/system/cpu/cpu0/topology/physical_package_id", 0)
        with self.assertRaises(agent.CollectorUnavailable):
            agent.collect_thermal(self.ctx)


class IpmiTest(unittest.TestCase):
    def setUp(self):
        self.m = agent.parse_ipmi_sensors(fixture("ipmitool_sensor.txt"))

    def test_temperature_and_limits(self):
        t = one(self.m, "hw.temperature", sensor="CPU1 Temp")
        self.assertEqual((t.value, t.hw_type), (45.0, "cpu"))
        self.assertEqual(one(self.m, "hw.temperature.limit", sensor="CPU1 Temp", limit_type="high").value, 85.0)
        self.assertEqual(one(self.m, "hw.temperature.limit", sensor="CPU1 Temp", limit_type="critical").value, 95.0)
        self.assertEqual(one(self.m, "hw.temperature", sensor="System Temp").hw_type, "board")
        self.assertEqual(one(self.m, "hw.temperature.limit", sensor="System Temp", limit_type="high").value, 80.0)
        # lower thresholds that read "na" never become limits
        self.assertEqual(len(by(self.m, "hw.temperature.limit", sensor="System Temp")), 2)

    def test_na_values_are_absent(self):
        self.assertEqual(by(self.m, "hw.temperature", sensor="Inlet Temp"), [])
        self.assertEqual(by(self.m, "hw.fan.speed", sensor="FAN2"), [])

    def test_fan_and_voltage(self):
        self.assertEqual(one(self.m, "hw.fan.speed", sensor="FAN1").value, 5600.0)
        self.assertEqual(one(self.m, "hw.fan.speed.limit", sensor="FAN1", limit_type="low.critical").value, 500.0)
        self.assertEqual(one(self.m, "hw.voltage", sensor="12V").value, 12.1)
        self.assertEqual(one(self.m, "hw.voltage.limit", sensor="12V", limit_type="low.critical").value, 10.8)
        self.assertEqual(one(self.m, "hw.voltage.limit", sensor="12V", limit_type="high.critical").value, 13.2)
        self.assertEqual(one(self.m, "hw.voltage.limit", sensor="12V", limit_type="low").value, 11.0)
        self.assertEqual(one(self.m, "hw.voltage.limit", sensor="12V", limit_type="high").value, 13.0)

    def test_zero_limits_skipped(self):
        # "Temp-2" has unc/ucr of 0.000: no limit at all
        self.assertEqual(by(self.m, "hw.temperature.limit", sensor="Temp-2"), [])
        self.assertTrue(all(x.value > 0 for x in self.m if x.name.endswith(".limit")))

    def test_duplicate_names_get_suffixes(self):
        temps = {x.hw_id: x.value for x in by(self.m, "hw.temperature") if x.attrs["sensor"].startswith("Temp")}
        self.assertEqual(temps, {"Temp": 40.0, "Temp-2": 52.0, "Temp-3": 33.0})
        self.assertEqual(one(self.m, "hw.temperature", sensor="Temp-2").hw_id, "Temp-2")
        self.assertEqual(one(self.m, "hw.temperature.limit", sensor="Temp", limit_type="critical").value, 90.0)

    def test_entity_ids_type_duplicate_temps(self):
        m = agent.parse_ipmi_sensors(fixture("ipmitool_sensor.txt"),
                                     agent.parse_sdr_entities(fixture("sdr_elist_full.txt")))
        self.assertEqual(one(m, "hw.temperature", sensor="Temp").hw_type, "cpu")
        self.assertEqual(one(m, "hw.temperature", sensor="Temp-2").hw_type, "cpu")
        self.assertEqual(one(m, "hw.temperature", sensor="Temp-3").hw_type, "memory")
        self.assertEqual(one(self.m, "hw.temperature", sensor="Temp-3").hw_type, "board")

    def test_discrete_psu_lines_ignored_in_sensor_path(self):
        self.assertEqual(by(self.m, "hw.power_supply.status"), [])


class PsuSdrTest(TmpRootCase):
    def test_parse(self):
        m = agent.parse_psu_sdr(fixture("sdr_power_supply.txt"))
        st = {x.attrs["sensor"]: x.value for x in m}
        self.assertEqual(st, {
            "PS1 Status": 1, "PS2 Status": 0, "PS3 Status": 0, "PS4 Status": 0, "PS5 Status": 0,
            "PS Redundancy": 1, "PSU Redundancy": 0, "PS Redundancy B": 0})
        self.assertEqual(m[0].hw_type, "power_supply")
        self.assertEqual(m[0].hw_id, "PS1 Status")

    def test_more_failure_texts(self):
        for text in ("Presence detected, Power Supply input lost (AC/DC)", "Input out-of-range",
                     "Presence detected, Fan failure", "Power Supply failure detected"):
            line = "PS9 Status | 0h | ok | 10.9 | " + text
            self.assertEqual(agent.parse_psu_sdr(line)[0].value, 0, text)

    def test_collect_ipmi_runs_both_commands(self):
        calls = []

        def run(args, timeout=60):
            calls.append(args)
            if args[1] == "sensor":
                return 0, fixture("ipmitool_sensor.txt")
            if args[2] == "elist":
                return 0, fixture("sdr_elist_full.txt")
            return 0, fixture("sdr_power_supply.txt")

        self.ctx.run = run
        m = agent.collect_ipmi(self.ctx)
        self.assertIn(["ipmitool", "sdr", "elist", "full"], calls)
        self.assertIn(["ipmitool", "sdr", "type", "Power Supply"], calls)
        self.assertEqual(one(m, "hw.power_supply.status", sensor="PS2 Status").value, 0)
        self.assertEqual(one(m, "hw.temperature", sensor="CPU1 Temp").value, 45.0)

    def test_sdr_failure_keeps_sensors(self):
        def run(args, timeout=60):
            if args[1] == "sensor":
                return 0, fixture("ipmitool_sensor.txt")
            raise RuntimeError("timed out")

        self.ctx.run = run
        m = agent.collect_ipmi(self.ctx)
        self.assertEqual(by(m, "hw.power_supply.status"), [])
        self.assertTrue(by(m, "hw.fan.speed"))


class SelTest(TmpRootCase):
    def test_parse(self):
        entries = agent.parse_sel(fixture("sel_elist.txt"))
        self.assertEqual([e[0] for e in entries], [1, 2, 10, 11, 12])
        self.assertEqual(entries[2][2:4], ("Memory #0x10", "Uncorrectable ECC"))

    def test_first_run_records_last_id_and_sends_nothing(self):
        self.ctx.run = lambda args, timeout=60: (0, fixture("sel_elist.txt"))
        self.assertEqual(agent.collect_sel(self.ctx), [])
        self.assertEqual(self.ctx.events, [])
        with open(os.path.join(self.state, "sel_last_id")) as f:
            self.assertEqual(f.read().strip(), "12")

    def test_new_entries_become_events(self):
        write(self.state, "sel_last_id", "1")
        self.ctx.run = lambda args, timeout=60: (0, fixture("sel_elist.txt"))
        agent.collect_sel(self.ctx)
        self.assertEqual(len(self.ctx.events), 4)
        temp, mem, cleared, plain = self.ctx.events
        self.assertEqual(temp["metadata"]["hw.sel.direction"], "asserted")
        self.assertEqual(temp["message"].count("Asserted"), 1)
        self.assertEqual(cleared["level"], "info")
        self.assertEqual(cleared["metadata"]["hw.sel.direction"], "deasserted")
        self.assertTrue(cleared["message"].endswith("| Deasserted"))
        self.assertEqual(cleared["message"].count("Deasserted"), 1)
        self.assertEqual(plain["level"], "critical")
        self.assertEqual(plain["metadata"]["hw.sel.direction"], "asserted")
        self.assertEqual(temp["metadata"]["hw.event.type"], "thermal")
        self.assertEqual(temp["level"], "warn")
        self.assertEqual(mem["metadata"]["hw.event.type"], "memory")
        self.assertEqual(mem["level"], "critical")
        self.assertEqual(mem["metadata"]["hw.event.source"], "sel")
        self.assertEqual(mem["service"], "hardware")
        self.assertEqual(mem["hostname"], "testhost")
        # a second pass must not resend
        self.ctx.events = []
        agent.collect_sel(self.ctx)
        self.assertEqual(self.ctx.events, [])

    def test_no_ipmitool(self):
        def run(args, timeout=60):
            raise agent.CollectorUnavailable("ipmitool not installed")

        self.ctx.run = run
        with self.assertRaises(agent.CollectorUnavailable):
            agent.collect_sel(self.ctx)

    def test_no_bmc_device(self):
        self.ctx.run = lambda args, timeout=60: (1, "")
        with self.assertRaises(agent.CollectorUnavailable):
            agent.collect_ipmi(self.ctx)


class NetTest(TmpRootCase):
    def test_physical_only(self):
        n = "sys/class/net/"
        write(self.root, n + "eth0/device/vendor", "0x8086")
        for f, v in (("rx_errors", 1), ("tx_errors", 2), ("rx_crc_errors", 3),
                     ("rx_dropped", 4), ("tx_dropped", 5)):
            write(self.root, n + "eth0/statistics/" + f, v)
        write(self.root, n + "eth0/carrier_changes", 6)
        write(self.root, n + "eth0/operstate", "up")
        write(self.root, n + "eth0/speed", "1000")
        write(self.root, n + "docker0/operstate", "up")
        write(self.root, n + "docker0/statistics/rx_errors", 99)
        m = agent.collect_net(self.ctx)
        self.assertTrue(all(x.hw_id == "eth0" for x in m))
        self.assertEqual(one(m, "hw.network.errors", direction="receive", error_type="crc").value, 3)
        self.assertEqual(one(m, "hw.network.errors", direction="transmit", error_type="errors").value, 2)
        self.assertEqual(one(m, "hw.network.errors", direction="receive", error_type="dropped").value, 4)
        self.assertEqual(one(m, "hw.network.carrier_changes").value, 6)
        up = one(m, "hw.network.up")
        self.assertEqual((up.value, up.attrs["speed_mbps"], up.hw_type), (1, 1000, "network"))

    def test_down_link_without_speed(self):
        n = "sys/class/net/eth1/"
        write(self.root, n + "device/vendor", "x")
        write(self.root, n + "operstate", "down")
        write(self.root, n + "speed", "-1")
        up = one(agent.collect_net(self.ctx), "hw.network.up")
        self.assertEqual(up.value, 0)
        self.assertNotIn("speed_mbps", up.attrs)


class HostInfoTest(TmpRootCase):
    def test_bare_metal(self):
        write(self.root, "sys/class/dmi/id/sys_vendor", "Dell Inc.\n")
        write(self.root, "sys/class/dmi/id/product_name", "PowerEdge R740\n")
        write(self.root, "proc/sys/kernel/osrelease", "6.8.0-45-generic\n")
        write(self.root, "proc/cpuinfo", "processor : 0\nflags : fpu vme sse\n")
        write(self.root, "proc/meminfo", "MemTotal:       16384000 kB\nMemFree: 1 kB\n")
        self.ctx.run = lambda args, timeout=60: (1, "none\n")
        m = agent.collect_host(self.ctx)
        info = one(m, "hw.host.info")
        self.assertEqual(info.hw_type, "host")
        self.assertIs(info.attrs["hw.virtual"], False)
        self.assertEqual(info.attrs["hw.vendor"], "Dell Inc.")
        self.assertEqual(info.attrs["hw.model"], "PowerEdge R740")
        self.assertEqual(info.attrs["os.kernel"], "6.8.0-45-generic")
        self.assertEqual(info.attrs["agent.version"], "1.7.0")
        self.assertEqual(one(m, "hw.memory.size").value, 16384000 * 1024)

    def test_vm_by_hypervisor_flag(self):
        write(self.root, "proc/cpuinfo", "flags : fpu hypervisor sse\n")
        self.ctx.run = lambda args, timeout=60: (1, "none\n")
        self.assertIs(one(agent.collect_host(self.ctx), "hw.host.info").attrs["hw.virtual"], True)

    def test_vm_by_vendor(self):
        write(self.root, "sys/class/dmi/id/sys_vendor", "QEMU\n")
        self.ctx.run = lambda args, timeout=60: (1, "none\n")
        self.assertIs(one(agent.collect_host(self.ctx), "hw.host.info").attrs["hw.virtual"], True)

    def test_vm_by_systemd_detect_virt(self):
        self.ctx.run = lambda args, timeout=60: (0, "kvm\n")
        self.assertIs(one(agent.collect_host(self.ctx), "hw.host.info").attrs["hw.virtual"], True)


class KmsgTest(unittest.TestCase):
    def setUp(self):
        self.lines = fixture("kmsg_lines.txt").split("\n")

    def classify(self, raw):
        rec = agent.parse_kmsg_record(raw)
        return agent.classify_kmsg(rec[2]) if rec else None

    def test_parse_record(self):
        prio, ts, msg = agent.parse_kmsg_record(self.lines[0])
        self.assertEqual((prio, ts), (3, 5000000))
        self.assertTrue(msg.startswith("blk_update_request"))
        self.assertIsNone(agent.parse_kmsg_record(" SUBSYSTEM=block"))
        self.assertIsNone(agent.parse_kmsg_record("garbage"))
        # facility bits are masked out of the priority (kern=0, daemon=24)
        self.assertEqual(agent.parse_kmsg_record("30,1,1,-;x")[0], 6)

    def test_classification(self):
        expected = ["disk", "disk", "memory", "memory", "pcie", "thermal", "network",
                    "network", "disk", None, None, None, None]
        got = [self.classify(line) for line in self.lines]
        self.assertEqual(got[:11], expected[:11])

    def test_extra_patterns(self):
        c = agent.classify_kmsg
        self.assertEqual(c("ata1.00: failed command: READ FPDMA QUEUED"), "disk")
        self.assertEqual(c("sd 0:0:0:0: [sda] tag#1 Medium Error"), "disk")
        self.assertEqual(c("Buffer I/O error on dev sdb1, logical block 5"), "disk")
        self.assertEqual(c("ata2: SATA link down (SStatus 0 SControl 300)"), "disk")
        self.assertEqual(c("nvme nvme0: controller is down; will reset"), "disk")
        self.assertEqual(c("e1000e: eth0 NIC Link is Down"), "network")
        self.assertEqual(c("e1000e 0000:00:19.0 eth0: Detected Tx Unit Hang"), "network")
        self.assertEqual(c("pcieport 0000:00:1c.0: PCIe Bus Error: severity=Uncorrected"), "pcie")
        self.assertEqual(c("mce: [Hardware Error]: CPU 3: Machine Check: 0 Bank 5"), "cpu")
        self.assertEqual(c("EDAC MC0: 1 UE memory read error"), "memory")
        self.assertEqual(c("Power supply redundancy lost"), "power")
        self.assertIsNone(c("systemd[1]: Started Session 4 of user root."))

    def test_new_patterns(self):
        c = agent.classify_kmsg
        self.assertEqual(c("NETDEV WATCHDOG: eth0 (e1000e): transmit queue 0 timed out"), "network")
        for line in ("ata1.00: exception Emask 0x0 SAct 0x0 SErr 0x0 action 0x6 frozen",
                     "ata1.00: failed command: READ DMA EXT",
                     "ata1.00: failed command: WRITE FPDMA QUEUED",
                     "ata1.00: failed command: FLUSH CACHE EXT",
                     "sd 0:0:0:0: [sda] Unrecovered read error - auto reallocate failed",
                     "nvme nvme0: Device not ready; aborting reset, will reset",
                     "ata4: reset failed, probe failure"):
            self.assertEqual(c(line), "disk", line)

    def test_boot_noise_is_not_shipped(self):
        c = agent.classify_kmsg
        self.assertIsNone(c("EDAC MC: Ver: 3.0.0"))
        self.assertIsNone(c("EDAC sbridge: Giving out device to module sb_edac controller Sandy Bridge SrcID#0_Ha#0"))
        self.assertIsNone(c("EDAC MC0: Giving out device to module skx_edac controller Skylake Socket#0"))
        self.assertIsNone(c("ACPI: Power Supply [ADP1] online"))
        self.assertEqual(c("EDAC MC0: 2 CE memory read error on DIMM_A1"), "memory")
        self.assertEqual(c("EDAC sbridge MC0: UE memory read error"), "memory")
        self.assertEqual(c("mce: [Hardware Error]: Machine check events logged"), "memory")
        self.assertEqual(c("Power supply 1 failure detected"), "power")

    def test_levels(self):
        self.assertEqual(agent.kmsg_level(2), "critical")
        self.assertEqual(agent.kmsg_level(3), "error")
        self.assertEqual(agent.kmsg_level(4), "warn")
        self.assertEqual(agent.kmsg_level(6), "warn")

    def test_event_shape(self):
        cfg = agent.Config({"LOGTIDE_HOSTNAME": "h1", "HOST_ROOT": "/nonexistent"})
        reader = agent.KmsgReader(cfg, lambda events: None)
        reader._boot = 1000.0
        ev = reader.event_from_line(self.lines[0])
        self.assertEqual(ev["service"], "hardware")
        self.assertEqual(ev["level"], "error")
        self.assertEqual(ev["hostname"], "h1")
        self.assertEqual(ev["metadata"]["hw.event.source"], "kmsg")
        self.assertEqual(ev["metadata"]["hw.event.type"], "disk")
        self.assertEqual(ev["metadata"]["host.name"], "h1")
        self.assertEqual(ev["time"], "1970-01-01T00:16:45.000Z")
        self.assertIsNone(reader.event_from_line(self.lines[9]))


class OtlpTest(unittest.TestCase):
    def test_payload_shape(self):
        metrics = [
            agent.Metric("hw.temperature", 45.5, "cpu", "coretemp", {"sensor": "Package id 0"}),
            agent.Metric("hw.temperature", 30.0, "board", "nct", {"sensor": "temp2"}),
            agent.Metric("hw.host.info", 1, "host", "host", {"hw.virtual": False, "hw.vendor": "Dell"}),
            agent.Metric("hw.network.up", 1, "network", "eth0", {"speed_mbps": 1000}),
        ]
        payload = agent.build_otlp_metrics(metrics, "box1", now_ns=1700000000000000000)
        json.dumps(payload)
        rm = payload["resourceMetrics"][0]
        res = {a["key"]: a["value"] for a in rm["resource"]["attributes"]}
        self.assertEqual(res["service.name"], {"stringValue": "logtide-hw-agent"})
        self.assertEqual(res["host.name"], {"stringValue": "box1"})
        out = rm["scopeMetrics"][0]["metrics"]
        self.assertEqual([m["name"] for m in out], ["hw.temperature", "hw.host.info", "hw.network.up"])
        temp = out[0]
        self.assertEqual(temp["unit"], "Cel")
        self.assertEqual(len(temp["gauge"]["dataPoints"]), 2)
        dp = temp["gauge"]["dataPoints"][0]
        self.assertEqual(dp["timeUnixNano"], "1700000000000000000")
        self.assertEqual(dp["asDouble"], 45.5)
        attrs = {a["key"]: a["value"] for a in dp["attributes"]}
        self.assertEqual(attrs["host.name"], {"stringValue": "box1"})
        self.assertEqual(attrs["hw.type"], {"stringValue": "cpu"})
        self.assertEqual(attrs["hw.id"], {"stringValue": "coretemp"})
        self.assertEqual(attrs["sensor"], {"stringValue": "Package id 0"})
        info = {a["key"]: a["value"] for a in out[1]["gauge"]["dataPoints"][0]["attributes"]}
        self.assertEqual(info["hw.virtual"], {"boolValue": False})
        net = {a["key"]: a["value"] for a in out[2]["gauge"]["dataPoints"][0]["attributes"]}
        self.assertEqual(net["speed_mbps"], {"intValue": "1000"})

    def test_every_point_has_required_attributes(self):
        payload = agent.build_otlp_metrics(
            [agent.Metric("hw.fan.speed", 1000, "fan", "f", {"sensor": "fan1"})], "h")
        for m in payload["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]:
            for dp in m["gauge"]["dataPoints"]:
                keys = [a["key"] for a in dp["attributes"]]
                for required in ("host.name", "hw.type", "hw.id"):
                    self.assertIn(required, keys)
                self.assertIsInstance(dp["asDouble"], float)


class CollectorIsolationTest(TmpRootCase):
    def test_failure_and_absence_do_not_break_others(self):
        write(self.root, "sys/class/hwmon/hwmon0/name", "coretemp")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "40000")

        def boom(ctx):
            raise RuntimeError("kaboom")

        def gone(ctx):
            raise agent.CollectorUnavailable("nope")

        with mock.patch.dict(agent.COLLECTORS, {"smart": boom, "ipmi": gone}):
            metrics = agent.run_collectors(self.ctx, ["smart", "hwmon", "ipmi"])
        status = {m.attrs["collector"]: m.value for m in by(metrics, "hw.agent.collector.status")}
        self.assertEqual(status, {"smart": 0, "hwmon": 1, "ipmi": 0})
        self.assertEqual(one(metrics, "hw.temperature").value, 40.0)
        self.assertEqual(one(metrics, "hw.agent.collector.status", collector="smart").hw_type, "agent")

    def test_partial_results_of_failed_collector_are_discarded(self):
        def half(ctx):
            raise ValueError("after partial work")

        with mock.patch.dict(agent.COLLECTORS, {"net": half}):
            metrics = agent.run_collectors(self.ctx, ["net"])
        self.assertEqual(by(metrics, "hw.network.errors"), [])

    def test_missing_binaries_report_zero(self):
        def run(args, timeout=60):
            raise agent.CollectorUnavailable("%s not installed" % args[0])

        self.ctx.run = run
        metrics = agent.run_collectors(self.ctx, ["smart", "ipmi", "sel", "edac", "thermal", "kmsg"])
        status = {m.attrs["collector"]: m.value for m in by(metrics, "hw.agent.collector.status")}
        self.assertEqual(status, {"smart": 0, "ipmi": 0, "sel": 0, "edac": 0, "thermal": 0, "kmsg": 0})
        self.assertEqual(len(by(metrics, "hw.host.info")), 1)

    def test_collector_selection_from_env(self):
        cfg = agent.Config({"LOGTIDE_HW_COLLECTORS": "smart, hwmon,bogus"})
        self.assertEqual(cfg.collectors, ["smart", "hwmon"])
        self.assertEqual(agent.Config({}).collectors, list(agent.ALL_COLLECTORS))


class ConfigTest(TmpRootCase):
    def test_hostname_from_host_root(self):
        cfg = agent.Config({"HOST_ROOT": self.root})
        write(self.root, "etc/hostname", "rack-07\n")
        self.assertEqual(cfg.hostname, "rack-07")

    def test_hostname_env_wins_and_fallback(self):
        self.assertEqual(agent.Config({"LOGTIDE_HOSTNAME": "x", "HOST_ROOT": self.root}).hostname, "x")
        with mock.patch("socket.gethostname", return_value="fallback"):
            self.assertEqual(agent.Config({"HOST_ROOT": self.root}).hostname, "fallback")

    def test_defaults(self):
        cfg = agent.Config({})
        self.assertEqual(cfg.interval, 60)
        self.assertEqual(cfg.state_dir, "/var/lib/logtide-hw-agent")
        self.assertFalse(cfg.dry_run)
        self.assertEqual(agent.AGENT_VERSION, "1.7.0")


class FakeResponse(object):
    def read(self):
        return b"{}"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(code):
    return urllib.error.HTTPError("http://x", code, "err", {}, None)


class SenderTest(unittest.TestCase):
    def setUp(self):
        self.cfg = agent.Config({"LOGTIDE_URL": "http://backend:8080/", "LOGTIDE_API_KEY": "lp_k"})
        self.sleeps = []
        self.sender = agent.Sender(self.cfg, sleep=self.sleeps.append)

    def test_metrics_request(self):
        seen = []

        def urlopen(req, timeout=0):
            seen.append(req)
            return FakeResponse()

        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertTrue(self.sender.send_metrics({"resourceMetrics": []}))
        req = seen[0]
        self.assertEqual(req.full_url, "http://backend:8080/v1/otlp/metrics")
        self.assertEqual(req.get_header("X-api-key"), "lp_k")
        self.assertEqual(req.get_header("Content-type"), "application/json")

    def test_retries_5xx_with_backoff_then_succeeds(self):
        results = [http_error(503), urllib.error.URLError("down"), FakeResponse()]

        def urlopen(req, timeout=0):
            r = results.pop(0)
            if isinstance(r, Exception):
                raise r
            return r

        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertTrue(self.sender.send_metrics({}))
        self.assertEqual(self.sleeps, [1, 2])

    def test_4xx_drops_without_retry(self):
        calls = []

        def urlopen(req, timeout=0):
            calls.append(1)
            raise http_error(401)

        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertFalse(self.sender.send_metrics({}))
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.sleeps, [])

    def test_logs_kept_after_5xx_and_dropped_after_4xx(self):
        ev = agent.make_event("h", "I/O error, dev sda", "error", "kmsg", "disk")
        with mock.patch("urllib.request.urlopen", mock.Mock(side_effect=http_error(500))):
            self.assertFalse(self.sender.send_logs([ev]))
        self.assertEqual(self.sender.pending, 1)
        bodies = []

        def urlopen(req, timeout=0):
            bodies.append(json.loads(req.data.decode()))
            return FakeResponse()

        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertTrue(self.sender.send_logs([]))
        self.assertEqual(self.sender.pending, 0)
        self.assertEqual(bodies[0]["logs"][0]["service"], "hardware")
        with mock.patch("urllib.request.urlopen", mock.Mock(side_effect=http_error(400))):
            self.assertFalse(self.sender.send_logs([ev]))
        self.assertEqual(self.sender.pending, 0)

    def test_dry_run_prints_instead_of_sending(self):
        cfg = agent.Config({"LOGTIDE_HW_DRY_RUN": "1"})
        sender = agent.Sender(cfg)
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("must not send")):
            with mock.patch("builtins.print") as printed:
                self.assertTrue(sender.send_metrics({"a": 1}))
                self.assertTrue(sender.send_logs([{"message": "x"}]))
        self.assertEqual(printed.call_count, 2)


class CollectOnceTest(TmpRootCase):
    def test_full_cycle_dry_run(self):
        write(self.root, "sys/class/hwmon/hwmon0/name", "coretemp")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "40000")
        self.ctx.run = lambda args, timeout=60: (_ for _ in ()).throw(
            agent.CollectorUnavailable("none"))
        self.config.dry_run = True
        sender = agent.Sender(self.config)
        sent = []
        with mock.patch("builtins.print", lambda s: sent.append(s)):
            self.assertTrue(agent.collect_once(self.ctx, sender))
        payload = json.loads(sent[0])
        names = [m["name"] for m in payload["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]]
        self.assertIn("hw.temperature", names)
        self.assertIn("hw.agent.collector.status", names)
        self.assertIn("hw.host.info", names)


class FakeProc(object):
    """A child that ignores SIGKILL: communicate always times out."""
    pid = 4242

    def __init__(self, *a, **kw):
        pass

    def kill(self):
        pass

    def poll(self):
        return None

    def communicate(self, timeout=None):
        import subprocess
        raise subprocess.TimeoutExpired("x", timeout)


class CommandTimeoutTest(TmpRootCase):
    def test_slow_command_is_killed_and_reaped(self):
        import time
        started = time.time()
        with self.assertRaises(agent.CommandTimeout) as cm:
            self.ctx.run([sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.5)
        self.assertIsNone(cm.exception.proc)
        self.assertLess(time.time() - started, 15)

    def test_stuck_child_is_abandoned_not_waited_on(self):
        with mock.patch("subprocess.Popen", FakeProc), mock.patch.object(agent, "KILL_WAIT", 0.01):
            with self.assertRaises(agent.CommandTimeout) as cm:
                self.ctx.run(["smartctl", "-a"], timeout=0.01)
        self.assertEqual(cm.exception.proc.pid, 4242)

    def test_too_many_stuck_children_blocks_new_ones(self):
        for i in range(agent.MAX_STUCK_CHILDREN):
            self.ctx.abandoned["d%d" % i] = FakeProc()
        with self.assertRaises(agent.CollectorTimeout):
            self.ctx.run(["smartctl", "-a"])


class SmartBudgetTest(TmpRootCase):
    def setUp(self):
        TmpRootCase.setUp(self)
        patcher = mock.patch.object(agent, "read_by_id_map", return_value={})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_per_device_timeout_is_15s(self):
        seen = []

        def run(args, timeout=60):
            seen.append(timeout)
            if "--scan-open" in args:
                return 0, fixture("smartctl_scan.json")
            return 0, fixture("smart_ata_healthy.json")

        self.ctx.run = run
        agent.collect_smart(self.ctx)
        self.assertTrue(all(t <= 15 for t in seen), seen)
        self.assertTrue(all(t > 10 for t in seen), seen)

    def test_stuck_device_is_skipped_while_previous_probe_lives(self):
        self.ctx.abandoned["/dev/sda"] = FakeProc()
        probed = []

        def run(args, timeout=60):
            if "--scan-open" in args:
                return 0, fixture("smartctl_scan.json")
            probed.append(args[3])
            return 0, fixture("smart_nvme_healthy.json")

        self.ctx.run = run
        metrics = agent.collect_smart(self.ctx)
        self.assertNotIn("/dev/sda", probed)
        self.assertIn("/dev/nvme0", probed)
        self.assertTrue(metrics)
        self.assertIn("/dev/sda", self.ctx._stuck_logged)

    def test_timeout_with_stuck_child_is_remembered(self):
        stuck = FakeProc()

        def run(args, timeout=60):
            if "--scan-open" in args:
                return 0, fixture("smartctl_scan.json")
            if args[3] == "/dev/sda":
                raise agent.CommandTimeout("stuck", stuck)
            return 0, fixture("smart_nvme_healthy.json")

        self.ctx.run = run
        agent.collect_smart(self.ctx)
        self.assertIs(self.ctx.abandoned["/dev/sda"], stuck)

    def test_all_devices_stuck_raises(self):
        for d in ("/dev/sda", "/dev/nvme0", "/dev/sdc"):
            self.ctx.abandoned[d] = FakeProc()
        self.ctx.run = lambda args, timeout=60: (0, fixture("smartctl_scan.json"))
        with self.assertRaises(RuntimeError):
            agent.collect_smart(self.ctx)


class BackgroundSmartTest(TmpRootCase):
    def test_slow_smart_does_not_block_or_flap(self):
        import threading
        write(self.root, "sys/class/hwmon/hwmon0/name", "coretemp")
        write(self.root, "sys/class/hwmon/hwmon0/temp1_input", "40000")
        release = threading.Event()
        mode = {"slow": False}

        def smart(ctx):
            if mode["slow"]:
                release.wait(10)
            return [agent.Metric("hw.physical_disk.smart_status", 1, "physical_disk", "S1", {})]

        def status(metrics):
            return {m.attrs["collector"]: m.value for m in by(metrics, "hw.agent.collector.status")}

        self.ctx.background = {"smart"}
        self.ctx.smartctl_available = lambda: False
        with mock.patch.dict(agent.COLLECTORS, {"smart": smart}), \
                mock.patch.dict(agent.COLLECTOR_BUDGET, {"smart": 0.3}):
            names = ["smart", "hwmon"]
            m1 = agent.run_collectors(self.ctx, names)
            self.assertEqual(status(m1)["smart"], 1)
            self.assertEqual(len(by(m1, "hw.physical_disk.smart_status")), 1)
            mode["slow"] = True
            m2 = agent.run_collectors(self.ctx, names)  # late: still OK, no smart data, others present
            self.assertEqual(status(m2), {"smart": 1, "hwmon": 1})
            self.assertEqual(by(m2, "hw.physical_disk.smart_status"), [])
            self.assertEqual(len(by(m2, "hw.temperature")), 1)
            m3 = agent.run_collectors(self.ctx, names)  # second timeout in a row
            self.assertEqual(status(m3)["smart"], 0)
            release.set()
            self.ctx.runners["smart"].thread.join(5)
            m4 = agent.run_collectors(self.ctx, names)  # the late result is picked up
            self.assertEqual(status(m4)["smart"], 1)
            self.assertEqual(len(by(m4, "hw.physical_disk.smart_status")), 1)

    def test_first_cycle_timeout_without_history_reports_zero(self):
        import threading
        release = threading.Event()

        def smart(ctx):
            release.wait(10)
            return []

        self.ctx.background = {"smart"}
        with mock.patch.dict(agent.COLLECTORS, {"smart": smart}), \
                mock.patch.dict(agent.COLLECTOR_BUDGET, {"smart": 0.1}):
            m = agent.run_collectors(self.ctx, ["smart"])
            release.set()
        self.assertEqual(one(m, "hw.agent.collector.status", collector="smart").value, 0)

    def test_real_failure_reports_zero_immediately(self):
        def smart(ctx):
            raise RuntimeError("boom")

        self.ctx.background = {"smart"}
        self.ctx.last_status["smart"] = 1
        with mock.patch.dict(agent.COLLECTORS, {"smart": smart}):
            m = agent.run_collectors(self.ctx, ["smart"])
        self.assertEqual(one(m, "hw.agent.collector.status", collector="smart").value, 0)

    def test_sync_collector_timeout_has_same_grace(self):
        def ipmi(ctx):
            raise agent.CollectorTimeout("slow bmc")

        self.ctx.last_status["ipmi"] = 1
        with mock.patch.dict(agent.COLLECTORS, {"ipmi": ipmi}):
            s1 = one(agent.run_collectors(self.ctx, ["ipmi"]), "hw.agent.collector.status").value
            s2 = one(agent.run_collectors(self.ctx, ["ipmi"]), "hw.agent.collector.status").value
        self.assertEqual((s1, s2), (1, 0))


class KmsgBatchTest(unittest.TestCase):
    def make(self, **kw):
        cfg = agent.Config({"LOGTIDE_HOSTNAME": "h", "HOST_ROOT": "/nonexistent"})
        sent = []
        reader = agent.KmsgReader(cfg, lambda events: sent.append(list(events)))
        for k, v in kw.items():
            setattr(reader, k, v)
        return reader, sent

    def test_flushes_inside_the_loop_at_500_lines(self):
        reader, sent = self.make(MIN_FLUSH_GAP=0)
        for i in range(1200):
            reader.offer({"i": i})
        self.assertEqual([len(b) for b in sent], [500, 500])
        self.assertEqual(len(reader.batch), 200)

    def test_hard_cap_drops_and_counts(self):
        import time
        reader, sent = self.make(MIN_FLUSH_GAP=1000)
        reader.last_flush = time.time()
        for i in range(agent.KmsgReader.HARD_CAP + 25):
            reader.offer({"i": i})
        self.assertEqual(len(reader.batch), agent.KmsgReader.HARD_CAP)
        self.assertEqual(reader.dropped, 25)
        with self.assertLogs("logtide-hw-agent", level="WARNING") as logs:
            reader.maybe_flush(force=True)
        self.assertIn("dropped 25", logs.output[0])
        self.assertEqual(reader.dropped, 0)
        self.assertEqual(len(sent[0]), agent.KmsgReader.HARD_CAP)

    def test_time_based_flush(self):
        reader, sent = self.make(FLUSH_SECONDS=0, MIN_FLUSH_GAP=0)
        reader.offer({"i": 1})
        reader.maybe_flush()
        self.assertEqual(len(sent), 1)


class SenderLockAndSkewTest(unittest.TestCase):
    def setUp(self):
        self.cfg = agent.Config({"LOGTIDE_URL": "http://b", "LOGTIDE_API_KEY": "k"})

    def test_lock_not_held_during_http(self):
        sender = agent.Sender(self.cfg, sleep=lambda s: None)
        held = []

        def urlopen(req, timeout=0):
            got = sender._lock.acquire(False)
            held.append(got)
            if got:
                sender._lock.release()
            raise urllib.error.URLError("down")

        ev = agent.make_event("h", "I/O error, dev sda", "error", "kmsg", "disk")
        with mock.patch("urllib.request.urlopen", urlopen):
            self.assertFalse(sender.send_logs([ev]))
        self.assertTrue(held and all(held))
        self.assertEqual(sender.pending, 1)

    def test_requeue_respects_cap_and_keeps_newest(self):
        sender = agent.Sender(self.cfg, sleep=lambda s: None)
        sender.MAX_PENDING_LOGS = 10
        with mock.patch("urllib.request.urlopen", mock.Mock(side_effect=urllib.error.URLError("x"))):
            sender.send_logs([{"message": str(i)} for i in range(8)])
            self.assertEqual(sender.pending, 8)
            sender.send_logs([{"message": str(i)} for i in range(8, 14)])
        self.assertEqual(sender.pending, 10)
        self.assertEqual(sender._pending_logs[-1]["message"], "13")
        self.assertEqual(sender._pending_logs[0]["message"], "4")

    def test_skew_warns_once_per_hour(self):
        import email.utils
        now = [1700000000.0]
        sender = agent.Sender(self.cfg, clock=lambda: now[0])
        far = email.utils.formatdate(now[0] - 900, usegmt=True)
        with self.assertLogs("logtide-hw-agent", level="WARNING") as logs:
            sender.check_skew(far)
            sender.check_skew(far)
            now[0] += 1800
            sender.check_skew(far)
            self.assertEqual(len(logs.output), 1)
            now[0] += 3600
            sender.check_skew(far)
        self.assertEqual(len(logs.output), 2)
        self.assertIn("ahead of", logs.output[0])

    def test_small_or_missing_skew_is_silent(self):
        import email.utils
        now = 1700000000.0
        sender = agent.Sender(self.cfg, clock=lambda: now)
        with self.assertRaises(AssertionError):  # assertLogs fails when nothing is logged
            with self.assertLogs("logtide-hw-agent", level="WARNING"):
                sender.check_skew(email.utils.formatdate(now - 60, usegmt=True))
                sender.check_skew(None)
                sender.check_skew("garbage")

    def test_post_reads_date_header(self):
        sender = agent.Sender(self.cfg)
        seen = []
        sender.check_skew = seen.append

        class Resp(FakeResponse):
            headers = {"Date": "Tue, 10 Nov 2026 12:00:00 GMT"}

        with mock.patch("urllib.request.urlopen", lambda req, timeout=0: Resp()):
            self.assertTrue(sender.send_metrics({}))
        self.assertEqual(seen, ["Tue, 10 Nov 2026 12:00:00 GMT"])


if __name__ == "__main__":
    unittest.main()
