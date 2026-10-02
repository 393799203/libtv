FROM alpine:3.19

# tzdata 必需：compose 里设了 TZ=Asia/Shanghai，alpine 默认不带时区库，
# 缺了它 TZ 解析不出来会退回 UTC，Redis 自身日志的时间戳就差 8 小时
RUN apk add --no-cache redis tzdata && \
    mkdir -p /data

# 必须切到 /data：redis 的 appendonly 默认写到工作目录（dir 配置），
# 而镜像默认工作目录是 /，AOF 会落在容器可写层（/appendonlydir）——
# 容器一旦重建（改 command、docker 重启、宿主机重启）数据全丢，
# 队列里排队的任务、幂等标记、上游任务引用都会消失。
WORKDIR /data

VOLUME /data

EXPOSE 6379

CMD ["redis-server", "--appendonly", "yes"]
