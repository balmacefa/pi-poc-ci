# Pi + POC tooling on Red Hat UBI 9. Pi comes from npm unless a local build is mounted at /opt/pi-local.
FROM registry.access.redhat.com/ubi9/ubi:latest

ARG PI_VERSION=latest
ARG NODE_STREAM=22

RUN dnf -y module enable nodejs:${NODE_STREAM} \
 && dnf -y install --setopt=install_weak_deps=False nodejs npm git findutils \
 && dnf clean all \
 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22 || (a===22 && b<19)) { console.error("Node >= 22.19 required, got " + process.version); process.exit(1) }'

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION}

COPY docker/entrypoint.sh /usr/local/bin/pi-entry
RUN chmod 0755 /usr/local/bin/pi-entry \
 && useradd --uid 1000 --create-home pi \
 && mkdir -p /home/pi/.pi/agent /workspace \
 && chown -R pi:pi /home/pi /workspace

USER pi
WORKDIR /workspace
ENV PI_CLI=/usr/local/bin/pi-entry \
    PI_TELEMETRY=0

ENTRYPOINT ["/usr/local/bin/pi-entry"]
