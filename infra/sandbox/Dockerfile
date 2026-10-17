FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

ENV NODE_ENV=production \
    CI=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_USERCONFIG=/dev/null

WORKDIR /workspace

USER root
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && chown node:node /workspace

COPY --chown=node:node baseline-runner.mjs /opt/obsidian/baseline-runner.mjs

USER node

ENTRYPOINT ["node", "/opt/obsidian/baseline-runner.mjs"]
