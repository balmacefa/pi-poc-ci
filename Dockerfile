# Pi + POC tooling on Red Hat UBI 9. Pi comes from npm unless a local build is mounted at /opt/pi-local.
FROM registry.access.redhat.com/ubi9/ubi:latest

ARG PI_VERSION=latest
ARG BOB_VERSION=latest
ARG NODE_STREAM=22

RUN dnf -y module enable nodejs:${NODE_STREAM} \
 && dnf -y install --setopt=install_weak_deps=False nodejs npm git findutils \
 && dnf clean all \
 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22 || (a===22 && b<19)) { console.error("Node >= 22.19 required, got " + process.version); process.exit(1) }'

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION}

# Claude Code CLI for the `claude-cli` provider bridge (cli-bridge extension).
# No --ignore-scripts: its postinstall downloads the native Linux binary.
# Note: in the container it uses ANTHROPIC_API_KEY (not the host subscription).
# `agy`/Antigravity is a Windows binary and is auto-discarded on Linux.
RUN npm install -g @anthropic-ai/claude-code \
 && claude --version

# IBM Bob Shell: a second agent available in the image (needs BOB_API_KEY at runtime). Requires Node >= 22.15.
RUN npm install -g --ignore-scripts @ibm/bob@${BOB_VERSION}

COPY docker/entrypoint.sh /usr/local/bin/pi-entry
RUN chmod 0755 /usr/local/bin/pi-entry \
 && useradd --uid 1000 --create-home pi \
 && mkdir -p /home/pi/.pi/agent /home/pi/.bob /workspace \
 && chown -R pi:pi /home/pi /workspace

USER pi
WORKDIR /workspace
ENV PI_CLI=/usr/local/bin/pi-entry \
    PI_TELEMETRY=0

ENTRYPOINT ["/usr/local/bin/pi-entry"]
