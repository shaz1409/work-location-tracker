FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:18-alpine AS runner

WORKDIR /app

RUN npm install -g vite

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

EXPOSE 5173

CMD ["vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
