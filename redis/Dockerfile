FROM alpine:3.19

RUN apk add --no-cache redis && \
    mkdir -p /data

VOLUME /data

EXPOSE 6379

CMD ["redis-server", "--appendonly", "yes"]
