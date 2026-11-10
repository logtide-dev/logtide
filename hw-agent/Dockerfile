# LogTide hardware agent.
#
# Runs as root on purpose: reading SMART data (smartctl), /dev/kmsg and
# /dev/ipmi0 needs raw device access and CAP_SYS_RAWIO / CAP_SYS_ADMIN /
# CAP_SYSLOG, which a non-root user inside the container cannot get.
FROM python:3.12-alpine

RUN apk add --no-cache smartmontools ipmitool

WORKDIR /app
COPY logtide_hw_agent.py /app/logtide_hw_agent.py

ENV PYTHONUNBUFFERED=1 \
    LOGTIDE_HW_STATE_DIR=/var/lib/logtide-hw-agent

VOLUME ["/var/lib/logtide-hw-agent"]

ENTRYPOINT ["python", "/app/logtide_hw_agent.py"]
