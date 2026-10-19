FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

ENV NODE_ENV=production \
    CI=true \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_USERCONFIG=/dev/null

WORKDIR /workspace

USER root
RUN set -eux; \
    for attempt in 1 2 3; do \
      if apt-get update && apt-get upgrade -y; then break; fi; \
      if [ "$attempt" -eq 3 ]; then exit 1; fi; \
      rm -rf /var/lib/apt/lists/*; \
      sleep 5; \
    done; \
    rm -rf /var/lib/apt/lists/*; \
    chown node:node /workspace

# Keep the bundled npm CLI on a patched release. The worker invokes npm only
# for the reviewed offline script shapes, so upgrading the CLI preserves the
# execution contract while removing vulnerable transitive npm packages from
# the base Node image.
RUN npm install --global --no-audit --no-fund --ignore-scripts \
    --fetch-retries=5 --fetch-retry-factor=2 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=20000 \
    npm@11.21.1

COPY --chown=node:node baseline-runner.mjs /opt/obsidian/baseline-runner.mjs

USER node

ENTRYPOINT ["node", "/opt/obsidian/baseline-runner.mjs"]
