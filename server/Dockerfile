FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY relay.mjs billing.mjs apple-root-ca-g3.cer admin.mjs entrypoint.sh ./
COPY site ./site
RUN chmod 755 entrypoint.sh && mkdir -p /data && chown node:node /data
EXPOSE 8787
# Starts as root only to fix ownership of a mounted volume, then drops to the unprivileged "node" user.
ENTRYPOINT ["/app/entrypoint.sh"]
