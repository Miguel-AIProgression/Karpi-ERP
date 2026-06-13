FROM node:20-slim
WORKDIR /app
COPY package.json .
COPY server.js .
COPY portal.html .
EXPOSE 8080
CMD ["node", "server.js"]
