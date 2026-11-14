#!/usr/bin/env bash
# VEYE on Google Cloud — the provisioning plan, PRINTED, never executed.
#
# This script only echoes the commands an operator would run, in order, for
# one environment. It has no "apply" mode on purpose: the project, billing,
# BAA / covered-services confirmation, DNS and the rotated credentials are the
# owner's decisions, and none of them exists yet. Review the output, then run
# the steps by hand once each prerequisite in the release gate is met.
#
#   PROJECT_ID=veye-staging REGION=us-central1 ENV=staging ./plan.sh
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID (a VEYE-owned project, one per environment)}"
: "${REGION:?set REGION}"
: "${ENV:?set ENV to staging or production}"

say() { printf '%s\n' "$*"; }

say "# 0. Prerequisites (owner): project exists and is VEYE-owned; billing linked; BAA signed and"
say "#    every service below confirmed as covered; credentials rotated; DNS delegated."
say "gcloud config set project ${PROJECT_ID}"
say
say "# 1. APIs"
say "gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \\"
say "  artifactregistry.googleapis.com cloudscheduler.googleapis.com storage.googleapis.com \\"
say "  vpcaccess.googleapis.com servicenetworking.googleapis.com"
say
say "# 2. Service identities (no JSON keys, ever)"
for sa in veye-api veye-web veye-scheduler; do
  say "gcloud iam service-accounts create ${sa} --display-name='${sa} (${ENV})'"
done
say "gcloud projects add-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:veye-api@${PROJECT_ID}.iam.gserviceaccount.com --role=roles/cloudsql.client"
say "gcloud projects add-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:veye-scheduler@${PROJECT_ID}.iam.gserviceaccount.com --role=roles/run.invoker"
say
say "# 3. Artifact Registry"
say "gcloud artifacts repositories create veye --repository-format=docker --location=${REGION}"
say
say "# 4. Cloud SQL — PostgreSQL 16, private IP only, backups + PITR on"
say "gcloud sql instances create veye-${ENV} --database-version=POSTGRES_16 --region=${REGION} \\"
say "  --no-assign-ip --network=default --backup-start-time=03:00 --enable-point-in-time-recovery"
say "gcloud sql databases create veye --instance=veye-${ENV}"
say "#    then: CREATE EXTENSION vector;  (pgvector) as the database owner"
say
say "# 5. Buckets — media and knowledge kept apart; versioning on media so a delete is recoverable"
say "#    for the retention window, and the erasure ledger (erasure-ledger/) lives in the media bucket"
say "gcloud storage buckets create gs://veye-${ENV}-member-media --location=${REGION} --uniform-bucket-level-access --public-access-prevention"
say "gcloud storage buckets update gs://veye-${ENV}-member-media --versioning"
say "gcloud storage buckets create gs://veye-${ENV}-knowledge --location=${REGION} --uniform-bucket-level-access --public-access-prevention"
say "gcloud storage buckets add-iam-policy-binding gs://veye-${ENV}-member-media --member=serviceAccount:veye-api@${PROJECT_ID}.iam.gserviceaccount.com --role=roles/storage.objectAdmin"
say "gcloud storage buckets add-iam-policy-binding gs://veye-${ENV}-knowledge --member=serviceAccount:veye-api@${PROJECT_ID}.iam.gserviceaccount.com --role=roles/storage.objectAdmin"
say
say "# 6. Secrets — values are entered interactively by the owner, never on a command line in history"
for secret in veye-database-url veye-smtp-username veye-smtp-password veye-telemetry-pseudonym-key veye-prospect-encryption-keys; do
  say "gcloud secrets create ${secret} --replication-policy=user-managed --locations=${REGION}"
  say "gcloud secrets versions add ${secret} --data-file=-      # paste, then Ctrl-D"
  say "gcloud secrets add-iam-policy-binding ${secret} --member=serviceAccount:veye-api@${PROJECT_ID}.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor"
done
say "#    veye-prospect-encryption-keys format: kid:base64(32 random bytes), e.g. from"
say "#    python -c \"import os,base64;print('k1:'+base64.b64encode(os.urandom(32)).decode())\""
say
say "# 7. Build (same commit, one web build per environment), push, migrate, deploy with no traffic"
say "docker build -f docker/api.production.Dockerfile -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/veye/api:\${IMAGE_SHA} api"
say "docker build -f docker/web.production.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://\${API_HOST} -t ${REGION}-docker.pkg.dev/${PROJECT_ID}/veye/web-${ENV}:\${IMAGE_SHA} web"
say "gcloud run jobs replace deployment/gcp/migrate.job.yaml && gcloud run jobs execute veye-migrate --wait"
say "gcloud run services replace deployment/gcp/api.service.yaml --no-traffic"
say "gcloud run services replace deployment/gcp/web.service.yaml --no-traffic"
say "gcloud run jobs replace deployment/gcp/maintenance.job.yaml"
say "#    then shift traffic: gcloud run services update-traffic veye-api --to-latest"
say
say "# 8. HTTPS load balancer + managed certificate + Cloud Armor; uptime checks on /health and /login;"
say "#    alerts on 5xx rate, p95 latency, Cloud SQL CPU/disk, failed maintenance executions, and on"
say "#    notification_outbox rows in status 'failed' (a relay that stops working is otherwise silent)."
say
say "# 9. Restore rehearsal BEFORE go-live: restore the latest backup to a scratch instance, point a"
say "#    scratch API revision at it, run the maintenance job with: run replay-erasures, sign in as a"
say "#    synthetic member, record the elapsed time (that number is the real RTO)."
