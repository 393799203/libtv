FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

ENV GOPROXY=https://goproxy.cn,direct

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server/

FROM alpine:3.19

RUN apk add --no-cache tzdata curl ca-certificates && \
    ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

COPY --from=builder /app/server .
COPY configs/ ./configs/

# 创建存储目录结构 (volume挂载前)
RUN mkdir -p uploads public/canvas public/videos public/styles public/shows public/images

# 创建启动脚本,确保volume挂载后目录结构完整
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'mkdir -p /app/uploads /app/public/canvas /app/public/videos /app/public/styles /app/public/shows /app/public/images' >> /app/entrypoint.sh && \
    echo 'exec ./server' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

EXPOSE 8080

CMD ["/app/entrypoint.sh"]
