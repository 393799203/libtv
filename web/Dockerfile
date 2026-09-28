FROM alpine:3.19

RUN apk add --no-cache nginx && \
    mkdir -p /usr/share/nginx/html

COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/http.d/default.conf
# 应用本体（location/代理）抽成单独文件，由 443 那个 server 块 include
COPY libtv-app.conf /etc/nginx/libtv-app.conf
# ACME 校验目录片段：80 的两个 server 块都 include 它
COPY libtv-acme.conf /etc/nginx/libtv-acme.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
