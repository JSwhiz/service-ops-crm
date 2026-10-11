FROM golang:1.24.8-alpine AS build

ARG MINIO_VERSION
ENV CGO_ENABLED=0

RUN test -n "$MINIO_VERSION" \
    && go install "github.com/minio/minio@${MINIO_VERSION}"

FROM alpine:3.22

RUN apk add --no-cache ca-certificates curl
COPY --from=build /go/bin/minio /usr/local/bin/minio

ENTRYPOINT ["minio"]
