# Infrastructure

docker/    Local development via Docker Compose
k8s/       Kubernetes manifests (future)
render/    Render.com deployment blueprint

Local development:
  docker compose -f infrastructure/docker/docker-compose.yml up

Deploy to Render:
  Connect repo to Render → New Blueprint → point to infrastructure/render/render.yaml
