FROM node:20-slim
WORKDIR /app
COPY package.json index.js ./
RUN npm install express
EXPOSE 3000
CMD ["node", "index.js"]
