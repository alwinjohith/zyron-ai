This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## AI Model Setup

Zyron uses [Ollama](https://ollama.com) to run a local LLM. The current model is **qwen3:1.7b**.

**Model weights are NOT stored in this repository.** Each computer running Zyron needs to install Ollama and pull the model.

### Quick Setup

```bash
# 1. Install Ollama (if not already installed)
# Linux: curl -fsSL https://ollama.com/install.sh | sh
# macOS: brew install ollama
# Windows: Download from https://ollama.com/download

# 2. Run the setup script (idempotent, safe to run multiple times)
./scripts/setup-ai.sh
```

The script will:
- Verify Ollama is installed
- Check if Ollama server is running (warns if not)
- Pull `qwen3:1.7b` if not already present

### Running Ollama

Ollama **must be running** when Zyron uses the AI.

**Start manually:**
```bash
ollama serve
```

**Linux (systemd) - auto-start on boot:**
```bash
sudo systemctl enable --now ollama
```

**macOS (launchd) - auto-start on login:**
```bash
brew services start ollama
```

### Configuration

- Model: `qwen3:1.7b` (defined in `src/app/api/chat/route.ts`)
- Ollama URL: `http://localhost:11434` (override via `OLLAMA_URL` in `.env.local`)
- Generation options: `num_predict=256`, `temperature=0.3`, `top_p=0.9`
- Reasoning: disabled (`think: false`) for fast CPU responses

### Files in this repository

- `Modelfile` — Documents the model configuration for reproducibility
- `scripts/setup-ai.sh` — Automated setup script
- `.env.local` — Local environment (excluded from git)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn more about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.