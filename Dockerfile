FROM node:24-alpine
WORKDIR /app
COPY package.json server.mjs index.html ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node","server.mjs"]
