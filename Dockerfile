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

# 1. Install system dependencies
# Removed: wget, gnupg, google-chrome-stable, fonts (Not needed for pdfkit)
# Kept: libvips-dev (Required for image processing packages like 'sharp')
RUN apt-get update && apt-get install -y \
    procps \
    build-essential \
    libvips-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# Note: Since we are not using Puppeteer, we don't need special flags.
# Using 'npm ci' is faster and safer for production if you have a package-lock.json.
# If you don't have a lock file, use 'npm install' instead.
RUN npm install --production

# Copy the full project
COPY . .

# Cloud Run settings
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
