# Use official Node.js image
FROM node:20-slim

# Install system dependencies (required for sharp, multer, image processing)
RUN apt-get update && apt-get install -y \
    build-essential \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy the full project
COPY . .

# Cloud Run listens on port 8080 (mandatory)
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start your backend (server.js)
CMD ["node", "server.js"]  
