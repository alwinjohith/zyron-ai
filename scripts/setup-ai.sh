#!/usr/bin/env bash
# Zyron AI Setup Script
# Installs and configures Ollama with the qwen3:1.7b model

set -euo pipefail

MODEL="qwen3:1.7b"
OLLAMA_URL="http://localhost:11434"

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

print_info() {
    echo "[INFO] $1"
}

print_error() {
    echo "[ERROR] $1" >&2
}

print_success() {
    echo "[SUCCESS] $1"
}

print_warning() {
    echo "[WARNING] $1"
}

check_ollama_installed() {
    if command_exists ollama; then
        print_info "Ollama is installed: $(ollama --version)"
        return 0
    else
        print_error "Ollama is not installed."
        print_info "Install it from: https://ollama.com/download"
        print_info "Or on Linux: curl -fsSL https://ollama.com/install.sh | sh"
        return 1
    fi
}

check_ollama_running() {
    if curl -sf "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
        print_info "Ollama server is running at $OLLAMA_URL"
        return 0
    else
        print_warning "Ollama server is not running at $OLLAMA_URL"
        print_info "Start it with: ollama serve"
        print_info "On Linux (systemd): sudo systemctl enable --now ollama"
        return 1
    fi
}

model_exists() {
    ollama list 2>/dev/null | grep -q "^$MODEL "
}

pull_model() {
    if model_exists; then
        print_info "Model '$MODEL' is already installed."
    else
        print_info "Pulling model '$MODEL'... (this may take a few minutes)"
        ollama pull "$MODEL"
        print_success "Model '$MODEL' pulled successfully."
    fi
}

main() {
    echo "=== Zyron AI Setup ==="
    echo

    if ! check_ollama_installed; then
        exit 1
    fi

    echo
    check_ollama_running || true
    echo

    pull_model
    echo

    print_success "Zyron AI setup complete!"
    echo
    echo "Next steps:"
    echo "  1. Ensure Ollama is running: ollama serve (or systemctl start ollama)"
    echo "  2. Start Zyron: npm run dev"
    echo
    echo "Note: Ollama must be running whenever Zyron uses the AI."
}

main "$@"