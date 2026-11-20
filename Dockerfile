FROM node:20-alpine

WORKDIR /app

# Copy app files
COPY index.html .
COPY server.js .
COPY auth.js .
COPY scripts/reset-legacy-password.cjs ./scripts/reset-legacy-password.cjs

# Create data directory for persistent storage
RUN mkdir -p /data

# Expose port
EXPOSE 3000

# Run
CMD ["node", "server.js"]
