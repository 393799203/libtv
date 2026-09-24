FROM alpine:3.19

RUN apk add --no-cache redis && \
    mkdir -p /data

# 必须切到 /data：redis 的 appendonly 默认写到工作目录（dir 配置），
# 而镜像默认工作目录是 /，AOF 会落在容器可写层（/appendonlydir）——
# 容器一旦重建（改 command、docker 重启、宿主机重启）数据全丢，
# 队列里排队的任务、幂等标记、上游任务引用都会消失。
WORKDIR /data

VOLUME /data

EXPOSE 6379

CMD ["redis-server", "--appendonly", "yes"]
