# AMD Box Runbook — running WasteWise on the AMD Developer Cloud

Step-by-step for getting the backend live on the AMD Developer Cloud notebook
(`notebooks.amd.com/hackathon`, ROCm 7.2 + vLLM + PyTorch image) and reachable
by a Vercel preview deployment. Every gotcha below was hit and fixed once
already — read this before re-debugging from scratch.

## TL;DR

```bash
bash scripts/amd_setup.sh
```

Then follow the three-terminal instructions it prints. If it fails partway,
the sections below cover each step manually plus why it breaks.

## 0. Fix CA certificates first (every fresh box)

The box's CA bundle is sometimes missing/stale on boot. Every HTTPS client
(git, pip, wget) fails with `server certificate verification failed` until
this runs — and it does **not** persist across box resets, so expect to
redo this each new session:

```bash
apt-get update && apt-get install -y ca-certificates
update-ca-certificates
```

If that alone doesn't fix a specific `git`/`wget` call, fall back to
disabling verification for just that one command rather than leaving it off
globally:

```bash
git config --global http.sslVerify false
git pull --ff-only
git config --global http.sslVerify true
```

## 1. Clone / update the repo

```bash
git clone https://github.com/lostpay/wastewise.git ~/wastewise   # first time
cd ~/wastewise && git pull --ff-only                              # later
```

## 2. Install the backend — use ONE interpreter for install *and* run

There are two Pythons on this box (`/opt/venv/bin/python3` and a system
`python3`) and `pip`/`uvicorn` don't always resolve to the same one. If you
install with one and run uvicorn with the other, the app "starts" but
crashes on the first import it doesn't have (classically `xgboost`) because
none of `[project.dependencies]` actually landed where uvicorn looks.
**Always pin the interpreter explicitly:**

```bash
cd ~/wastewise/backend
PY=/opt/venv/bin/python3   # fall back to `python3` if that path doesn't exist
"$PY" -m pip install --upgrade pip setuptools wheel
"$PY" -m pip install .
```

Notes:
- Use plain `pip install .`, **not** `-e .` — some boxes ship a `setuptools`
  too old to support PEP 660 editable installs (`build_editable` hook
  missing), and you don't need editable mode on a throwaway deploy box
  anyway.
- The `--upgrade pip setuptools wheel` step matters even when the plain
  install "succeeds": a stale ambient `setuptools` silently ignores
  `pyproject.toml`'s `[project]` table and builds a metadata-less
  `UNKNOWN-0.0.0` package with **none of the dependencies installed** and no
  error shown. If `pip install .` ever reports installing `UNKNOWN` instead
  of `wastewise`, this is why — upgrade and reinstall.
- `backend/pyproject.toml` requires Python `>=3.10` (deliberately lowered
  from `3.11` — nothing in the codebase needs 3.11, and this box ships 3.10).

## 3. Serve the LLM on the AMD GPU

```bash
vllm serve mistralai/Mistral-7B-Instruct-v0.3 --port 8000
```

Use **Mistral-7B-Instruct-v0.3**, not `meta-llama/Llama-3.1-8B-Instruct` —
Llama is a gated HF repo and 401s without an approved HF token (approval
takes too long for a hackathon timeline). Mistral is open-access, no login
needed, and fits comfortably in the W7900's 48 GB.

Confirm it's really on the AMD GPU:
```bash
rocm-smi --showproductname --showmeminfo vram
```
Look for `Card Vendor: Advanced Micro Devices, Inc. [AMD/ATI]`, `GFX
Version: gfx1100`, and VRAM used climbing once the model loads — this is
also your evidence screenshot for `docs/AMD_USAGE.md`.

## 4. Run the backend, pointed at that vLLM instance

Same `$PY` as step 2:

```bash
cd ~/wastewise/backend
LLM_BASE_URL=http://localhost:8000/v1 \
LLM_MODEL=mistralai/Mistral-7B-Instruct-v0.3 \
LLM_API_KEY=dummy \
uvicorn wastewise.api:app --host 0.0.0.0 --port 8080
```

A successful boot prints a `[ LLM LIVE ]` self-check banner confirming a
real call to vLLM succeeded — screenshot that too, it's good evidence.

## 5. Expose it publicly

`cloudflared`'s download often fails on this box: `github.com` itself is
reachable, but the release CDN (`objects.githubusercontent.com`) is blocked,
so `wget`/`curl` silently produce a 0-byte file. Check before trusting it:

```bash
file ~/wastewise/cloudflared   # must say "ELF 64-bit executable", not "empty"
```

**If cloudflared works:**
```bash
~/wastewise/cloudflared tunnel --url http://localhost:8080
```

**If cloudflared is blocked (the common case on this box), use an SSH
tunnel instead — no download needed, just the SSH client that's already
there:**
```bash
ssh -R 80:localhost:8080 nokey@localhost.run
```
This prints a public `https://<random>.lhr.life` URL immediately.

### Getting a stable URL instead of a random one every reconnect

Anonymous SSH tunnels (`nokey@localhost.run`, unregistered `serveo.net`)
hand out a **new random subdomain every time the SSH session reconnects**.
Both services *do* support a fixed name, but only after you register an SSH
key with a free account (Google/GitHub OAuth, ~30 seconds).

Generate the key once (reused by both services below):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/lhr_key -N ""
```

**serveo.net:**
```bash
ssh -i ~/.ssh/lhr_key -o IdentitiesOnly=yes -o ServerAliveInterval=30 \
    -R wastewise-hackathon:80:localhost:8080 serveo.net
```
First connection prints a registration URL
(`https://console.serveo.net/ssh/keys?add=...`) — open it, log in with
GitHub, then reconnect with the same command. It should now consistently
give you `https://wastewise-hackathon.serveo.net`.

**localhost.run:**
```bash
ssh -R 80:localhost:8080 -i ~/.ssh/lhr_key -o StrictHostKeyChecking=no \
    -o ServerAliveInterval=30 localhost.run
```
Unlike serveo, presenting a key alone isn't enough here — it still connects
as "anonymous user" and hands out a random subdomain until you register an
account at `https://admin.localhost.run/` and add the key there. Until then,
treat this one as random-URL-per-reconnect, same as the `nokey@` form.

**Important distinction:** restarting *uvicorn* (step 4) never changes this
URL — only reconnecting the *SSH tunnel itself* does. So once the tunnel is
up, leave that terminal alone; you can redeploy backend code by restarting
uvicorn in its own terminal as many times as you want without breaking the
public URL. `-o ServerAliveInterval=30` also helps prevent the tunnel from
silently dying from an idle timeout and forcing an unwanted reconnect.

## 6. Wire it into Vercel

Put the public URL (no trailing path) into the Vercel **preview**
deployment's `NEXT_PUBLIC_API_URL` env var. Vercel does not hot-reload env
vars — you must trigger a new deployment (push a commit, or redeploy from
the dashboard) for it to take effect. CORS is already open
(`allow_origins=["*"]`) so no backend change is needed there.

Sanity check from your own machine (not the AMD box) to confirm it's
actually publicly reachable, independent of the frontend:
```bash
curl -s https://<your-tunnel-url>/health
```
Should return `{"status":"ok"}`.

## Known-slow step: sourcing

`agents/sourcing.py`'s `source_order()` makes one LLM call per line item.
This was originally sequential (an N-item order took N × ~50-70s — minutes
for a normal order) and has since been parallelized with a thread pool. If
sourcing is slow again after a fresh clone, confirm you actually pulled the
fix (`git log --oneline -- backend/wastewise/agents/sourcing.py`) and
reinstalled (step 2) before assuming it's a GPU/network problem.
