FROM node:20-slim
WORKDIR /app
COPY package.json index.js ./
RUN npm install
EXPOSE 8080
CMD ["node", "index.js"]
