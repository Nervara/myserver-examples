# Minimal, dependency-free build so the compose build-from-source path
# is exercised fast (no npm install, no language toolchain download).
FROM node:20-slim
WORKDIR /app
COPY server.js ./
EXPOSE 80
CMD ["node", "server.js"]
