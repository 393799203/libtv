FROM alpine:3.19

RUN apk add --no-cache nginx && \
    mkdir -p /usr/share/nginx/html

COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/http.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
