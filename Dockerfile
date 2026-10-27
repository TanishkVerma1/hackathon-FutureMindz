FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY vite.config.mjs ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.local-data OCR_TIMEOUT_MS=30000 ONNXRUNTIME_NODE_INSTALL=skip
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY backend ./backend
COPY datasets ./datasets
COPY models ./models
RUN mkdir -p /app/.local-data/uploads /app/.local-data/ocr-cache && chown -R node:node /app/.local-data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "backend/server.mjs"]
