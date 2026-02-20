FROM node:20-alpine

# Install build deps for native modules (node-pty, better-sqlite3)
RUN apk add --no-cache python3 make g++ bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Create data directory
RUN mkdir -p /data

EXPOSE 7000

ENV NODE_ENV=production \
    PORT=7000 \
    DATABASE_PATH=/data/mission_control.db

CMD ["node", "server.js"]
