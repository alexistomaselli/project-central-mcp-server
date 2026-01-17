FROM node:20-slim

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build the app - use a limit to avoid 'Killed'
RUN NODE_OPTIONS="--max-old-space-size=448" npm run build

# Clean up dev dependencies to save space
RUN npm prune --production

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
