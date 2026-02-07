FROM node:20-slim

# Install system dependencies for Python and Chrome
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    wget \
    gnupg \
    ca-certificates \
    libgconf-2-4 \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    lsb-release \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/lib/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install notebooklm-mcp
RUN pip3 install notebooklm-mcp

# Install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build the app
RUN NODE_OPTIONS="--max-old-space-size=448" npm run build

# Clean up
RUN npm prune --production

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/google-chrome-stable

# Use a custom start script to handle both servers if needed, 
# but for now we'll start the Node server which will bridge to Python.
CMD ["npm", "start"]
