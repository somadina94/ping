#!/bin/bash
set -euo pipefail

# Docker deployment script for PING.
# Run this from the repository root on the target server.
# Prefer sudo for Docker when the deploy user is not in the docker group.

echo "Starting Docker deployment of PING..."

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

# Check Docker installation
echo "Checking Docker installation..."
$SUDO docker --version

# Check for docker-compose or docker compose (newer versions use 'docker compose')
if $SUDO docker compose version &> /dev/null; then
    echo "docker compose found"
    DOCKER_COMPOSE="$SUDO docker compose"
elif command -v docker-compose &> /dev/null; then
    echo "docker-compose found"
    DOCKER_COMPOSE="$SUDO docker-compose"
else
    echo "Neither docker-compose nor docker compose found"
    exit 1
fi

# Check for environment variables
echo "Checking for environment variables..."
if [ -f ".env" ]; then
    echo ".env file found"
else
    echo "No .env file found. Create one from .env.example before deploying."
    exit 1
fi

# Build and start the application
echo "Building and starting the application..."
$DOCKER_COMPOSE --env-file .env up --build -d

# Check if the container is running
echo "Checking container status..."
sleep 5
$DOCKER_COMPOSE ps

# Show logs
echo "Recent logs:"
$DOCKER_COMPOSE logs --tail=20

echo "Docker deployment completed."
echo "Check status with: $DOCKER_COMPOSE ps"
echo "View logs with: $DOCKER_COMPOSE logs -f"
echo "Restart with: $DOCKER_COMPOSE restart"
echo "Stop with: $DOCKER_COMPOSE down"
