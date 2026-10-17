FROM node:22.19.0-bookworm-slim

ENV NODE_ENV=production \
    CI=true \
    NPM_CONFIG_IGNORE_SCRIPTS=true

WORKDIR /workspace

USER node

CMD ["node", "--version"]