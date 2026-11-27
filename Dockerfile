# Imagen de producción — Katú POS (multiempresa, un solo contenedor)
FROM node:20-alpine

WORKDIR /app

# Instala dependencias primero (cache de capas de Docker)
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Copia el resto del código (backend + frontend estático)
WORKDIR /app
COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 3008

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3008/api/v1/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
