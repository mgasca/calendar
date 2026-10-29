---
status: accepted
date: 2026-10-29
decision-makers: mgasca, Claude (AI assistant)
---

# Use Azure Container Apps as the compute platform

## Context and Problem Statement

Calendar needs internet-facing staging and production deployments for one or a few users, with low cost and a cloud newcomer operating them. The Google sign-in BFF and same-origin browser session are already defined by [ADR-0027](0027-google-oidc-bff-session.md). Which compute platform and service should run the application?

The owner has already chosen Azure as the deployment provider outside this decision. AWS alternatives are compared for context but do not meet that constraint.

## Decision Drivers

* **D1 Low cost**: minimise ongoing spend for sparse traffic.
* **D2 Operational simplicity**: a newcomer should be able to deploy and maintain the service.
* **D3 HTTPS ingress**: expose the app securely with a usable hostname and little setup.
* **D4 Container fit**: run the existing .NET application as a container and accommodate changing demand.

## Considered Options

* Azure Container Apps Consumption
* Azure App Service for containers
* Azure Kubernetes Service (AKS)
* Amazon ECS on AWS Fargate
* Amazon Lightsail container services

## Decision Outcome

Chosen option: "Azure Container Apps Consumption", because it satisfies the owner's Azure constraint and scale-to-zero suits sparse traffic (D1), while managed container hosting and built-in HTTPS ingress limit operational work (D2, D3) and support the application image (D4). AWS options are excluded by the provider constraint even where they score well.

| Driver | **Container Apps (chosen)** | App Service | AKS | ECS Fargate | Lightsail containers |
| --- | :---: | :---: | :---: | :---: | :---: |
| D1 Low cost | ★★★ | ★★☆ | ★☆☆ | ★★☆ | ★★☆ |
| D2 Operational simplicity | ★★★ | ★★★ | ★☆☆ | ★★☆ | ★★★ |
| D3 HTTPS ingress | ★★★ | ★★★ | ★☆☆ | ★★☆ | ★★★ |
| D4 Container fit | ★★★ | ★★☆ | ★★★ | ★★★ | ★★☆ |

### Deployment conventions

* Use a Consumption workload profile in UK South and Azure Container Registry (ACR) Basic for images. UK South is the planned location for related resources; regional SKU availability and quota must be checked in the actual subscription before provisioning.
* Start each app with minimum replicas **0** and maximum **1**, using HTTP-driven scaling. This prioritises cost and accepts cold starts and possible delays during scale-out. Measure cold-start latency and the cost of a warm replica after deployment; change the minimum to 1 if the delay is unacceptable. A single replica does not provide high availability.
* Enable external HTTP ingress with HTTPS redirection and use the default `azurecontainerapps.io` hostname. Configure the API to trust the appropriate forwarded headers and verify the public HTTPS origin for Google sign-in. Platform ingress terminates TLS; see [Microsoft ingress documentation](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview).
* The image topology, database, secret handling, infrastructure, deployment and environments are addressed separately by [ADR-0030](0030-single-container-for-api-and-spa.md), [ADR-0031](0031-azure-postgresql-flexible-server.md), [ADR-0032](0032-azure-key-vault-for-secrets.md), [ADR-0033](0033-bicep-for-infrastructure-as-code.md), [ADR-0034](0034-github-actions-oidc-deployment.md) and [ADR-0035](0035-separate-staging-and-production-environments.md).

### Cost estimate

Illustrative monthly compute cost is **$0** if both environments together consume at most 180,000 vCPU-seconds, 360,000 GiB-seconds and two million external requests and no other workload uses the subscription's grant. At 0.25 vCPU and 0.5 GiB this is up to 200 combined replica-hours, excluding any other consumption. Scale-to-zero incurs no replica resource charge, but uptime probes can wake replicas; actual billed time must be measured. These grants are per subscription, not per app ([billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)).

Microsoft's [retail prices API](https://prices.azure.com/api/retail/prices) lists a UK South Basic Registry Unit at $0.1666 per day (checked 2026-10-29), or about **$5 per registry for 30 days**, before tax and extra charges. The illustrative compute plus registry subtotal is therefore about $5 per registry per month under the free-grant assumptions above. This is not a total deployment cost: database, storage, backups, monitoring, secrets, networking, tax and any grant overage are excluded. Registry count depends on the environment design; confirm it and check the [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) before provisioning.

### Consequences

* Good, because low traffic can incur no compute charge within the shared grant.
* Good, because managed HTTPS ingress provides a hostname without running a separate ingress controller.
* Bad, because cold starts affect the first request after inactivity and frequent monitoring can reduce savings.
* Bad, because a single region and replica do not protect against regional or replica failures.
* Neutral, because the exact monthly bill and cold-start duration depend on actual usage and must be measured.

### Confirmation

Review infrastructure for UK South, the Consumption profile, ACR Basic, minimum zero and maximum one replica, and external HTTPS ingress. In staging, deploy the container, test HTTPS and Google sign-in after scale-to-zero, measure cold-start latency, and review actual cost after the first week. Confirm quota and regional SKUs before provisioning.

## Pros and Cons of the Options

### Azure Container Apps Consumption

* Good, because **D1 Low cost**: replicas can scale to zero and the subscription has a monthly consumption grant.
* Good, because **D2 Operational simplicity**: Azure manages the container environment and scaling.
* Good, because **D3 HTTPS ingress**: ingress supplies TLS termination and a default hostname.
* Good, because **D4 Container fit**: it runs container images and scales on HTTP traffic.
* Bad, because **D1 Low cost**: ACR and other services still incur charges.
* Bad, because **D4 Container fit**: scaling from zero introduces startup delay and requires restart-safe application state.

### Azure App Service for containers

* Bad, because **D1 Low cost**: an App Service plan reserves paid capacity even for little traffic.
* Good, because **D2 Operational simplicity**: managed web hosting avoids managing a Kubernetes cluster.
* Good, because **D3 HTTPS ingress**: managed web hosting provides an HTTPS hostname.
* Good, because **D4 Container fit**: it supports custom container images.
* Bad, because **D4 Container fit**: conventional plans do not provide the same consumption-based scale-to-zero model.

### Azure Kubernetes Service (AKS)

* Bad, because **D1 Low cost**: cluster worker capacity and supporting services are disproportionate for this workload.
* Bad, because **D2 Operational simplicity**: Kubernetes, cluster operations and upgrades add substantial responsibility.
* Bad, because **D3 HTTPS ingress**: internet ingress and TLS need additional configuration and components.
* Good, because **D4 Container fit**: Kubernetes supports container scheduling and scaling for complex workloads.

### Amazon ECS on AWS Fargate

* Good, because **D1 Low cost**: Fargate bills task resources by duration and ECS can scale tasks to zero with an appropriate demand metric. [Fargate pricing](https://aws.amazon.com/fargate/pricing/) and [ECS scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html) describe the details.
* Bad, because **D1 Low cost**: an Application Load Balancer and other supporting resources incur separate charges even when no task runs; scaling back from zero needs an appropriate metric and is not automatic HTTP wake-up.
* Good, because **D2 Operational simplicity**: AWS manages the underlying Fargate compute, although ECS networking, scaling, and load-balancer configuration still need care.
* Good, because **D3 HTTPS ingress**: an Application Load Balancer supports HTTPS, but it requires separate provisioning and certificate configuration ([ECS load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)).
* Good, because **D4 Container fit**: ECS runs container images as scalable Fargate tasks.

### Amazon Lightsail container services

* Bad, because **D1 Low cost**: the service is charged while enabled or disabled, so idle services do not scale to zero cost; [AWS](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services.html) describes hourly and capacity-based billing.
* Good, because **D2 Operational simplicity**: managed container capacity and built-in load balancing require little infrastructure management.
* Good, because **D3 HTTPS ingress**: the service provides a default HTTPS endpoint and redirects HTTP to HTTPS ([AWS FAQ](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-containers.html)).
* Good, because **D4 Container fit**: it runs Linux container images and permits changing capacity.
* Bad, because **D4 Container fit**: capacity changes are configured by the operator and private external registries are not supported; custom images can be pushed to Lightsail.

## More Information

Microsoft lists UK South for [Container Apps Express](https://learn.microsoft.com/en-us/azure/container-apps/express-overview), but availability of the selected standard environment and specific PostgreSQL Burstable SKU in this subscription remains unverified. Microsoft documents [Burstable PostgreSQL tiers](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), including their CPU-credit constraints and production support limitations; the database ADR owns that choice. Regional capacity, pricing and features can change.

AWS documents [Lightsail in London](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html); specific container-service capacity and Fargate availability in a particular account and London region remain unverified. AWS has [closed App Runner to new customers](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html), so it is not a viable new-customer option; AWS recommends ECS Express Mode as a migration alternative.
