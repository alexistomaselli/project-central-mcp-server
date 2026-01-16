# Build stage
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY --from=builder /app/dist ./dist

# EXPOSE the port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
