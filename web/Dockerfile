FROM alpine:3.19

# tzdata 必需：compose 里设了 TZ=Asia/Shanghai，但 alpine 默认不带时区库，
# 缺了它 TZ 解析不出来会静默退回 UTC，nginx 日志就比北京时间差 8 小时
RUN apk add --no-cache nginx tzdata && \
    mkdir -p /usr/share/nginx/html

COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/http.d/default.conf
# 应用本体（location/代理）抽成单独文件，由 443 那个 server 块 include
COPY libtv-app.conf /etc/nginx/libtv-app.conf
# ACME 校验目录片段：80 的两个 server 块都 include 它
COPY libtv-acme.conf /etc/nginx/libtv-acme.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
