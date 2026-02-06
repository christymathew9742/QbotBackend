# # Use official Node.js image
# FROM node:20-slim

# # Install system dependencies (required for sharp, multer, image processing)
# RUN apt-get update && apt-get install -y \
#     build-essential \
#     libvips-dev \
#     && rm -rf /var/lib/apt/lists/*

# # Create app directory
# WORKDIR /app

# # Copy package.json and package-lock.json
# COPY package*.json ./

# # Install production dependencies
# RUN npm install --production

# # Copy the full project
# COPY . .

# # Cloud Run listens on port 8080 (mandatory)
# ENV PORT=8080

# # Expose port
# EXPOSE 8080

# # Start your backend (server.js)
# CMD ["node", "server.js"]  



# Use official Node.js image
FROM node:20-slim

# 1. Install system dependencies for Puppeteer AND your existing ones (libvips)
# We add wget and gnupg to help install the official Google Chrome binary
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    build-essential \
    libvips-dev \
    --no-install-recommends

# 2. Install Google Chrome Stable (This ensures all browser deps are met)
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies 
# Note: We don't use --production if puppeteer needs to download its local revision, 
# but since we installed chrome-stable above, we'll point to that instead.
RUN npm install

# Copy the full project
COPY . .

# 3. Tell Puppeteer where the Chrome binary is located
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Cloud Run settings
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
