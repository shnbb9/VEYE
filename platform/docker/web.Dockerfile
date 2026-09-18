FROM node:22-bookworm-slim

LABEL io.veye.local=true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
