# Xenios – Server und Web-App im Container. Keine npm-Abhängigkeiten, daher kein Build-Schritt.
# Build-Kontext ist ../server (siehe compose.yaml). Start im Ordner docker/:  docker compose up -d
FROM node:24-alpine

LABEL org.opencontainers.image.title="Xenios" \
      org.opencontainers.image.description="Sicherer Web-Server und Web-App für die Xenia-Espressomaschine und die Mahlkönig E64 WS" \
      org.opencontainers.image.licenses="Apache-2.0"

# Ports und Pfade sind im Container fest (die Web-Oberfläche zeigt sie gesperrt an);
# alles andere stellt man nach dem Start im Browser ein.
ENV NODE_ENV=production \
    XENIOS_CONFIG=/data/config.json \
    XENIOS_DATA_DIR=/data \
    XENIOS_HTTP_HOST=0.0.0.0 \
    XENIOS_HTTP_PORT=8080 \
    XENIOS_HTTPS_HOST=0.0.0.0 \
    XENIOS_HTTPS_PORT=8443 \
    XENIOS_LAN_PORT=8081 \
    XENIOS_TRUST_PROXY=private

WORKDIR /app
# Programmdateien gehören root und sind für den Dienst-Benutzer nur lesbar
COPY package.json ./
COPY src ./src
COPY web ./web
RUN mkdir -p /data && chown node:node /data && chmod 700 /data

USER node
VOLUME ["/data"]
EXPOSE 8080 8081 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${XENIOS_HTTP_PORT}/healthz" || exit 1
CMD ["node", "src/index.js"]
