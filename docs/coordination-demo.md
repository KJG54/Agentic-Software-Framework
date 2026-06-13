# Two-Agent Coordination Loop — Demo Run

Date: 2026-06-12
Task: TASK-101
Agents: agent-alpha (primary checkout), agent-beta (fresh clone of GitHub repo)
Coordination branch: coordination/main on github.com/KJG54/Agentic-Software-Framework

## What was proven

1. **Queue publish** — agent-alpha published TASK-001..004 and TASK-101 to
   `coordination/queue/` and pushed to `coordination/main`.
2. **Cross-machine claim** — agent-beta, on a fresh clone, ran
   `appbuilder init-coordination` (fetched coordination state from origin)
   and `appbuilder claim TASK-101`; the claim commit pushed to GitHub.
3. **Claim conflict rejection** — agent-alpha pulled coordination state and
   attempted `claim TASK-101`; rejected:
   `TASK-101 is already claimed by agent-beta until 2026-06-13T03:50:25.626Z`.
4. **Push-time arbitration on stale state** — agent-beta, *without* syncing,
   attempted `claim TASK-001` (already claimed remotely by agent-alpha).
   The local check passed on stale state, but the push to coordination/main
   was rejected by GitHub (non-fast-forward), so the double-claim never
   became visible. Remote truth retained `owner: agent-alpha`.
5. **Handoff → ready → release** — agent-beta wrote this file on
   `agent/TASK-101-demo-prove-the-two-agent-coordination-loop`, handed off
   `complete`, passed `ready TASK-101`, and released; the claim file was
   deleted and both checkouts observed TASK-101 leave active status.

## Known rough edge observed

After a failed (stale) claim push, the loser's coordination worktree keeps a
local commit containing the conflicting claim and must be recovered with
`git fetch && git reset --hard origin/coordination/main`. A future task
should make `claim` fetch first and/or auto-recover on push rejection.
