#!/bin/bash

# LogTide Installation Script
# Inspired by SigNoz install.sh
# https://github.com/SigNoz/signoz/blob/main/deploy/install.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script version
VERSION="1.0.0"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║                                       ║"
echo "║         LogTide Installer             ║"
echo "║      Self-Hosted Log Management       ║"
echo "║                                       ║"
echo "║            Version $VERSION              ║"
echo "║                                       ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Detect OS
detect_os() {
    OS=$(uname -s)
    case "$OS" in
        Linux*)     PLATFORM="linux";;
        Darwin*)    PLATFORM="mac";;
        *)          PLATFORM="unknown";;
    esac
    echo -e "${BLUE}→${NC} Detected OS: ${GREEN}$PLATFORM${NC}"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Docker installation
check_docker() {
    echo ""
    echo -e "${BLUE}→${NC} Checking Docker installation..."

    if ! command_exists docker; then
        echo -e "${RED}✗${NC} Docker is not installed"
        echo ""
        echo "Please install Docker first:"
        if [ "$PLATFORM" = "mac" ]; then
            echo "  → Download from: https://docs.docker.com/desktop/mac/install/"
        else
            echo "  → Run: curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh"
        fi
        exit 1
    fi

    echo -e "${GREEN}✓${NC} Docker is installed"
    docker --version
}

# Check Docker Compose
check_docker_compose() {
    echo ""
    echo -e "${BLUE}→${NC} Checking Docker Compose..."

    # Try docker compose plugin first
    if docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker compose"
        echo -e "${GREEN}✓${NC} Docker Compose plugin is available"
        docker compose version
        return 0
    fi

    # Try standalone docker-compose
    if command_exists docker-compose; then
        DOCKER_COMPOSE="docker-compose"
        echo -e "${GREEN}✓${NC} Docker Compose (standalone) is available"
        docker-compose --version
        return 0
    fi

    echo -e "${RED}✗${NC} Docker Compose is not installed"
    echo ""
    echo "Please install Docker Compose:"
    echo "  → https://docs.docker.com/compose/install/"
    exit 1
}

# Check if port is available
check_port() {
    local port=$1
    local service=$2

    if command_exists lsof; then
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo -e "${YELLOW}⚠${NC}  Port $port ($service) is already in use"
            return 1
        fi
    elif command_exists netstat; then
        if netstat -tuln | grep -q ":$port "; then
            echo -e "${YELLOW}⚠${NC}  Port $port ($service) is already in use"
            return 1
        fi
    fi

    return 0
}

# Check required ports
check_ports() {
    echo ""
    echo -e "${BLUE}→${NC} Checking required ports..."

    PORTS_OK=true
    check_port 5432 "PostgreSQL" || PORTS_OK=false
    check_port 6379 "Redis" || PORTS_OK=false
    check_port 8080 "Backend API" || PORTS_OK=false
    check_port 3000 "Frontend" || PORTS_OK=false

    if [ "$PORTS_OK" = false ]; then
        echo ""
        echo -e "${YELLOW}Warning:${NC} Some ports are already in use."
        read -p "Do you want to continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Installation cancelled."
            exit 1
        fi
    else
        echo -e "${GREEN}✓${NC} All required ports are available"
    fi
}

# Generate random password
generate_password() {
    if command_exists openssl; then
        openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
    else
        date +%s | sha256sum | base64 | head -c 32
    fi
}

# Setup .env file
setup_env() {
    echo ""
    echo -e "${BLUE}→${NC} Setting up environment configuration..."

    if [ -f "docker/.env" ]; then
        echo -e "${YELLOW}⚠${NC}  docker/.env already exists"
        read -p "Do you want to overwrite it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Using existing docker/.env"
            return 0
        fi
    fi

    # Generate secure passwords
    DB_PASSWORD=$(generate_password)
    REDIS_PASSWORD=$(generate_password)
    API_KEY_SECRET=$(generate_password)

    # Create .env file in docker directory
    cat > docker/.env << EOF
# LogTide Production Configuration
# Auto-generated on $(date)

# Database
DB_NAME=logtide
DB_USER=logtide
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://logtide:$DB_PASSWORD@postgres:5432/logtide

# Redis
REDIS_PASSWORD=$REDIS_PASSWORD

# API
API_KEY_SECRET=$API_KEY_SECRET

# Frontend
PUBLIC_API_URL=http://localhost:8080

# SMTP (Optional - Configure for email alerts)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=your_email@example.com
# SMTP_PASS=your_smtp_password
# SMTP_FROM=noreply@logtide.local

# Internal Logging (Self-Monitoring)
INTERNAL_LOGGING_ENABLED=false

# Fluent Bit (Optional - Auto log collection)
# FLUENT_BIT_API_KEY=
EOF

    echo -e "${GREEN}✓${NC} Environment file created at docker/.env"
    echo -e "${YELLOW}⚠${NC}  Secure passwords have been generated automatically"
}

# Pull Docker images
pull_images() {
    echo ""
    echo -e "${BLUE}→${NC} Pulling Docker images..."
    cd docker
    $DOCKER_COMPOSE pull
    cd ..
    echo -e "${GREEN}✓${NC} Images pulled successfully"
}

# Start services
start_services() {
    echo ""
    echo -e "${BLUE}→${NC} Starting LogTide services..."
    echo ""

    cd docker
    $DOCKER_COMPOSE up -d --build
    cd ..

    echo ""
    echo -e "${GREEN}✓${NC} Services started"
}

# Wait for backend to be healthy
wait_for_backend() {
    echo ""
    echo -e "${BLUE}→${NC} Waiting for LogTide backend to be ready..."

    MAX_RETRIES=60
    RETRY_COUNT=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s -f http://localhost:8080/health >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} LogTide backend is ready!"
            return 0
        fi

        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo -n "."
        sleep 2
    done

    echo ""
    echo -e "${YELLOW}⚠${NC}  Backend did not respond within expected time"
    echo "This might be normal if images are building for the first time."
    echo ""
    echo "Check logs with: cd docker && $DOCKER_COMPOSE logs -f backend"
    return 1
}

# Show completion message
show_completion() {
    echo ""
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════╗"
    echo "║                                       ║"
    echo "║   ✓ LogTide Installation Complete!   ║"
    echo "║                                       ║"
    echo "╚═══════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "${BLUE}→${NC} Access LogTide:"
    echo -e "   Frontend: ${GREEN}http://localhost:3000${NC}"
    echo -e "   Backend API: ${GREEN}http://localhost:8080${NC}"
    echo -e "   API Docs: ${GREEN}http://localhost:8080/docs${NC}"
    echo ""
    echo -e "${BLUE}→${NC} Next steps:"
    echo "   1. Open http://localhost:3000 in your browser"
    echo "   2. Create your first account"
    echo "   3. Create an organization and project"
    echo "   4. Generate an API key"
    echo "   5. Start sending logs!"
    echo ""
    echo -e "${BLUE}→${NC} Useful commands:"
    echo "   View logs:        cd docker && $DOCKER_COMPOSE logs -f"
    echo "   Stop services:    cd docker && $DOCKER_COMPOSE down"
    echo "   Restart:          cd docker && $DOCKER_COMPOSE restart"
    echo "   Update:           cd docker && $DOCKER_COMPOSE pull && $DOCKER_COMPOSE up -d"
    echo ""
    echo -e "${BLUE}→${NC} Documentation:"
    echo "   README:           cat README.md"
    echo "   Setup Guide:      cat SETUP_GUIDE.md"
    echo "   Architecture:     cat docs/ARCHITECTURE.md"
    echo ""
    echo -e "${GREEN}Happy logging! 🚀${NC}"
    echo ""
}

# Show error and cleanup
show_error() {
    echo ""
    echo -e "${RED}"
    echo "╔═══════════════════════════════════════╗"
    echo "║                                       ║"
    echo "║      ✗ Installation Failed            ║"
    echo "║                                       ║"
    echo "╚═══════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "${YELLOW}Troubleshooting:${NC}"
    echo "  1. Check Docker is running: docker ps"
    echo "  2. Check logs: cd docker && $DOCKER_COMPOSE logs"
    echo "  3. Retry installation: ./install.sh"
    echo ""
    echo "For support, please open an issue on GitHub."
    echo ""
}

# Main installation flow
main() {
    detect_os
    check_docker
    check_docker_compose
    check_ports
    setup_env
    pull_images
    start_services

    if wait_for_backend; then
        show_completion
    else
        show_error
        exit 1
    fi
}

# Trap errors
trap 'show_error' ERR

# Run installation
main

exit 0
