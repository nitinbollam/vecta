# Kubernetes (Future)

Reserved for Kubernetes manifests when Vecta outgrows Render.

Planned:
- namespaces/     dev, staging, production
- deployments/    one Deployment per microservice
- services/       ClusterIP for internal comms
- ingress/        NGINX ingress for api-gateway
- hpa/            Horizontal Pod Autoscaler

Migrate when: any service needs more than 3 instances,
or monthly Render bill exceeds $2,000.
