# Stage 1: Install dependencies
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

# Stage 2: Build application
FROM node:20-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

CMD ["node", "index.js"]
