# sejm-mcp w kontenerze: serwer MCP na stdio, rozmawia wyłącznie z api.sejm.gov.pl.
# Uruchomienie: docker run -i --rm sejm-mcp
# Silnik OCR (Tesseract i pdf.js jako WebAssembly) jest kopiowany do dist/silnik-ocr przy budowaniu,
# więc obraz nie potrzebuje żadnych pakietów systemowych.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY skrypty ./skrypty
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-slim
LABEL org.opencontainers.image.title="sejm-mcp" \
      org.opencontainers.image.description="MCP server for the Polish Sejm open API (api.sejm.gov.pl)" \
      org.opencontainers.image.source="https://github.com/leniwyposel/sejm-mcp" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.modelcontextprotocol.server.name="io.github.leniwyposel/sejm-mcp"
ENV NODE_ENV=production \
    SEJM_MCP_SCHOWEK=/tmp/sejm-mcp
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY LICENSE NOTICE ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
