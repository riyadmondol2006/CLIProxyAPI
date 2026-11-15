# CLIProxyAPI server image: the proxy plus its web control panel.
#   docker build -t cliproxyapi .
#   docker run -d --name cliproxyapi -p 8317:8317 -v cliproxyapi-data:/data \
#     --restart unless-stopped cliproxyapi
# The first start creates /data/config.yaml and prints the management key to the logs
# (or uses CPA_MANAGEMENT_KEY). Open http://<host>:8317/ and log in with it.

# The control panel: a single-file build of desktop/frontend.
FROM docker.io/oven/bun:1.4.3 AS ui
WORKDIR /src/desktop/frontend
COPY desktop/frontend/package.json desktop/frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY desktop/frontend/ ./
# The Docs page bundles these from the repository root.
COPY config.example.yaml /src/config.example.yaml
COPY docs/ /src/docs/
ARG VERSION=dev
RUN VERSION="${VERSION}" bun run build

FROM docker.io/library/golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=none
ARG BUILD_DATE=unknown
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -buildvcs=false \
      -ldflags "-s -w -X 'main.Version=${VERSION}' -X 'main.Commit=${COMMIT}' -X 'main.BuildDate=${BUILD_DATE}'" \
      -o /out/cli-proxy-api ./cmd/server

FROM docker.io/library/debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 cliproxyapi \
    && useradd --system --uid 10001 --gid cliproxyapi --home-dir /data --no-create-home \
         --shell /usr/sbin/nologin cliproxyapi \
    && install -d -m 0750 -o cliproxyapi -g cliproxyapi /data
COPY --from=build /out/cli-proxy-api /usr/bin/cli-proxy-api
COPY --from=ui /src/desktop/frontend/dist/index.html /usr/share/cliproxyapi/management.html
COPY config.example.yaml /usr/share/cliproxyapi/config.example.yaml
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENV WRITABLE_PATH=/data
WORKDIR /data
USER cliproxyapi
VOLUME /data
EXPOSE 8317
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
