# LogTide hardware agent

Reads hardware health signals from a physical host and sends them to LogTide:
SMART (HDD, SSD, NVMe), ECC memory errors (EDAC), temperatures, fans and
voltages (hwmon, IPMI), CPU thermal throttling, physical NIC counters, kernel
hardware errors (`/dev/kmsg`) and the BMC event log. Metrics go to
`/v1/otlp/metrics`, events to `/api/v1/ingest` (service `hardware`).

Single Python file, standard library only (Python 3.8+). It runs as root because
SMART, `/dev/kmsg` and IPMI need raw device access. On a VM most sensors do not
exist; the agent reports that the host is virtual and the collectors that find
nothing report status 0.

## Run with Docker

```bash
docker run -d --name logtide-hw-agent --restart unless-stopped --privileged \
  -e LOGTIDE_URL=https://api.logtide.dev \
  -e LOGTIDE_API_KEY=lp_your_key \
  -e HOST_ROOT=/host \
  -v /sys:/host/sys:ro \
  -v /proc:/host/proc:ro \
  -v /etc/hostname:/host/etc/hostname:ro \
  -v logtide-hw-agent-state:/var/lib/logtide-hw-agent \
  logtide/hw-agent:latest
```

Check it works before leaving it running (prints the payloads, sends nothing):

```bash
docker run --rm --privileged -e HOST_ROOT=/host -e LOGTIDE_HW_DRY_RUN=1 \
  -v /sys:/host/sys:ro -v /proc:/host/proc:ro -v /etc/hostname:/host/etc/hostname:ro \
  logtide/hw-agent:latest --once
```

Why these mounts:

- `/sys` and `/proc` are mounted under `/host` and read through `HOST_ROOT`. The
  container's own `/sys/class/net` only shows the container's network namespace,
  so NIC counters would be wrong without the host mount.
- `--privileged` gives the container the host `/dev` (SATA/NVMe disks,
  `/dev/kmsg`, `/dev/ipmi0`) and the capabilities smartctl needs.
- The `/etc/hostname` mount makes the host name match the real host instead of the
  container id. Alternatively set `LOGTIDE_HOSTNAME`.
- The state volume keeps the BMC event log position across restarts.

Without `--privileged` you need `--cap-add SYS_RAWIO --cap-add SYS_ADMIN
--cap-add SYSLOG` plus one `--device` per disk (`/dev/sda`, `/dev/nvme0`...),
`--device /dev/kmsg` and `--device /dev/ipmi0` if present. This is more fragile
(seccomp and AppArmor profiles vary) and privileged is the tested path.

With the LogTide compose stack: `docker compose --profile hardware up -d`
(see `docker/docker-compose.yml`).

## Run with systemd

```bash
sudo apt install -y python3 smartmontools ipmitool   # ipmitool only on servers with a BMC
sudo install -d /opt/logtide-hw-agent /etc/logtide
sudo curl -fsSL https://raw.githubusercontent.com/logtide-dev/logtide/main/hw-agent/logtide_hw_agent.py \
  -o /opt/logtide-hw-agent/logtide_hw_agent.py
sudo curl -fsSL https://raw.githubusercontent.com/logtide-dev/logtide/main/hw-agent/logtide-hw-agent.service \
  -o /etc/systemd/system/logtide-hw-agent.service
sudo tee /etc/logtide/hw-agent.env >/dev/null <<'ENV'
LOGTIDE_URL=https://api.logtide.dev
LOGTIDE_API_KEY=lp_your_key
ENV
sudo chmod 600 /etc/logtide/hw-agent.env
sudo systemctl daemon-reload
sudo systemctl enable --now logtide-hw-agent
```

Verify once in the foreground, then follow the service log:

```bash
sudo sh -c 'set -a; . /etc/logtide/hw-agent.env; LOGTIDE_HW_DRY_RUN=1 python3 /opt/logtide-hw-agent/logtide_hw_agent.py --once'
journalctl -u logtide-hw-agent -f
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `LOGTIDE_URL` | required | Base URL of the LogTide API, e.g. `http://backend:8080` |
| `LOGTIDE_API_KEY` | required | Project API key, sent as `X-API-Key` |
| `LOGTIDE_HOSTNAME` | `${HOST_ROOT}/etc/hostname`, else the system hostname | Value of `host.name` |
| `HOST_ROOT` | empty | Prefix for `/sys`, `/proc` and `/etc` reads (`/host` in the container) |
| `LOGTIDE_HW_INTERVAL` | `60` | Seconds between collections (minimum 5) |
| `LOGTIDE_HW_COLLECTORS` | all | Comma list of `smart,edac,hwmon,thermal,ipmi,sel,net,kmsg` |
| `LOGTIDE_HW_STATE_DIR` | `/var/lib/logtide-hw-agent` | Where the last BMC event id is stored |
| `LOGTIDE_HW_DRY_RUN` | off | `1` prints payloads to stdout instead of sending |
| `LOGTIDE_HW_KMSG_PATH` | `/dev/kmsg` | Kernel log device (testing) |

`--once` runs one collection, sends it and exits (exit code 1 if delivery failed).

## Tests

```bash
python -m unittest discover -s hw-agent/tests
```
