FROM ziglings/ziglang:latest AS build

WORKDIR /app
COPY . .
RUN zig build -Doptimize=ReleaseSafe

FROM debian:bookworm-slim

WORKDIR /app
COPY --from=build /app/zig-out/bin/zig-jetzig .

EXPOSE 8080
CMD ./zig-jetzig --bind 0.0.0.0 --port ${PORT:-8080}
