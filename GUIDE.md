# The App Builder V2 Guide

*A plain-language tour of what this project is, everything it can do, and exactly how to take an
idea all the way to finished software — one step at a time.*

This is the friendly front door. You do not need to be a programmer to read it. If you want the
terse command reference, see [README.md](README.md); if you want the detailed operator's manual with
every flag and error message, see [HOWTO.md](HOWTO.md). This guide stands on its own — read it top to
bottom and you'll understand the whole system.

---

## 1. What is App Builder V2?

App Builder V2 is a **workbench for building software with the help of AI agents.** Think of it as an
**assembly line**: an idea goes in at one end, and at the other end comes out a small, tested,
ready-to-ship program. In between, the work moves through a fixed set of stations — plan it, lay the
foundation, build it, test it, review it, ship it — and nothing skips ahead until the previous
station is genuinely done.

The most important thing to understand up front:

> **The tool itself contains no artificial intelligence.** The `appbuilder` tool does not write your
> code or your plan. It *organizes* the work, *checks* that each step was really finished, and
> *records* what happened. The actual thinking — writing the plan, writing the code — is done by **AI
> agents** (and by you). The tool is the foreman on the assembly line, not the worker.

Why build it this way? Because AI agents are powerful but forgetful and occasionally over-eager. A
simple, predictable tool that refuses to let work move forward until it passes a check keeps the
whole process honest, repeatable, and safe — whether one agent is working or several are working at
once.

---

## 2. Who this is for, and how to read it

There are three kinds of readers, and three doors:

| If you are… | Read this | Then go to |
| --- | --- | --- |
| **Curious / nontechnical** — you want to understand what this is and how it works | **This guide**, top to bottom | nothing else required |
| **An operator** — you'll actually run the commands | This guide, then [HOWTO.md](HOWTO.md) | [README.md](README.md) for quick lookups |
| **An AI agent** working in the repo | [AGENTS.md](AGENTS.md) and [.agent/rules/](.agent/rules/) | this guide for the big picture |

You can stop after this guide and still understand the entire system. The other documents are there
when you want exact syntax or deeper detail.

---

## 3. The big picture

Everything in App Builder V2 rests on three simple ideas.

**1. The assembly line never skips a station.** Work flows through six phases in order. Each phase
produces a small file — a "report" — and the next phase refuses to start until that report exists.
A report on disk is the proof that a station finished its job. You can't test something that wasn't
built, and you can't ship something that wasn't reviewed.

**2. A human approves at two — and only two — moments.** The tool automates the busywork, but it
deliberately stops and waits for a person twice:
- **Before an idea becomes real work**, a human approves the plan.
- **Before any change is folded into the project**, a human reviews and approves it.

Everything else can run on its own; these two gates keep a person in control of *what gets built* and
*what gets accepted*.

**3. Everything is written down.** Plans, decisions, test results, reviews — all of it is saved as
plain files (called **artifacts**) you can open and read. Nothing important lives only in an agent's
memory. This is what makes the process auditable: you can always see what happened and why.

---

## 4. The workflow at a glance

Here is the whole assembly line. Read it left to right; the `‖` marks are the two human-approval
gates.

```text
                          ┌─────────────── the build loop ───────────────┐

   IDEA ──▶ PLAN ──‖──▶ SCAFFOLD ──▶ BUILD ──▶ TEST ──▶ REVIEW ──‖──▶ SHIP ──▶ 🚀
             │     ▲        │           │         │        │       ▲        │
        write the  │    lay the      write     run the   a human  │     final
        plan &    human   starter    the code  tests &   reads &  human  checklist
        tasks    approves  files     test-first checks   approves merge  to go live
                 the plan                                 the work the PR

   ‖ = a human must approve here
```

And here is the smaller loop that happens for **each individual task** while the code is being
written — this is how agents (or you) pick up a piece of work, do it, and hand it back:

```text
   claim ──▶ do the work (test-first) ──▶ handoff ──▶ ready ──▶ open a PR
     │                                                              │
  lock the task                                            a human reviews
  so two people                                             and merges it
  don't collide                                                  │
     ▲                                                           ▼
     └──────────────────── release (free the task) ◀──────────────
```

Don't worry if some words are unfamiliar — the next section defines every one of them.

---

## 5. Key terms, in plain words

| Term | What it means |
| --- | --- |
| **Agent** | An AI assistant (or a person) that does the actual thinking and building. The tool coordinates agents; it isn't one. |
| **The CLI / `appbuilder`** | The command-line tool at the heart of the workbench. "CLI" just means you run it by typing commands. It's sometimes called the *control plane* because it controls the flow of work. |
| **Artifact** | Any file the process produces and relies on — a plan, a report, a review. The paper trail. |
| **Gate** | A check that must pass before work can move forward. If the gate fails, nothing moves and nothing is written. |
| **Phase** | One station on the assembly line: plan, scaffold, build, test, review, or ship. |
| **Slug** | A short, lowercase nickname for a project (e.g. `word-counter`), used in file paths and commands. |
| **Plan** | The set of three files that describe a project: its *requirements* (what to build), its *architecture* (how it fits together), and its *task plan* (the list of jobs to do). |
| **Task** | One unit of work from the plan, with an ID like `TASK-001`. |
| **Scaffold** | The starter files for a project, generated from a reusable template — like a framed house before the rooms are finished. |
| **Template** | A reusable starter kit for a *type* of project. Seven ship today: `cli` (a command-line tool), `library` (reusable code), `app` (a small web service), `game` (a terminal game), `api` (a JSON REST API), `automation` (a batch/cron script), and `frontend` (a Vite + React web app). Run `appbuilder templates` for the live list. |
| **Build** | The phase where the code actually gets written, task by task. |
| **Test** | The phase where the tool runs the project's own automated checks and confirms they pass. |
| **Review** | The phase where a person reads the finished work and writes down their judgment, ending in *approved* or *changes requested*. |
| **Ship** | The final phase: the tool double-checks the entire chain and produces a go-live checklist. |
| **Claim** | Locking a task so you're the only one working on it — like taking a key off the board. |
| **Handoff** | A short written note recording what you did on a task, whether tests passed, and what's next. |
| **Ready** | A final pre-merge check confirming a task is genuinely finished and safe to fold in. |
| **Release** | Returning a finished task's "key" so the task is free again. |
| **Queue** | The shared, human-approved list of tasks waiting to be picked up. |
| **Coordination branch** | A private, shared space (a Git branch named `coordination/main`) where the queue, claims, and handoffs live so every agent sees the same picture. You never edit it by hand — the tool does it for you. |
| **PR (pull request)** | The standard way to propose folding a change into the main project so a human can review it before it's accepted. |

---

## 6. The workflow, step by step

This is the heart of the guide. Each phase below answers the same four questions: **what it's for**,
**what you do**, **what the tool checks or produces**, and **what you end up with**.

Throughout, commands are shown as `appbuilder <something>`. In practice you type
`node cli/appbuilder.js <something>` (the exact form is in [README.md](README.md)); `appbuilder` is
just the short name.

A rule that holds for every phase: **if a phase's report file exists, that phase passed.** The tool
writes the report *only* on success, and prints what went wrong (and writes nothing) on failure. So
the presence of a file is itself the proof.

### One-time setup

Before any project, the workbench needs to be switched on once:

- `appbuilder doctor` — a health check. It confirms the tool, the folders, and the project setup are
  all in order. Run this any time something feels off.
- `appbuilder init-coordination` — creates the shared space (the *coordination branch*) where tasks,
  claims, and handoffs will live. You do this once.
- `appbuilder status` — shows you the current state: which tasks are being worked on, anything stuck,
  anything left dangling.

### Phase 1 — Plan: turn an idea into a list of jobs  ‖ *(first human gate)*

**What it's for:** To decide *what* you're building before anyone writes a line of code.

**What you do:** Start with `appbuilder plan new <slug>`. The tool creates a fresh folder with three
empty templates to fill in. To fill them, an agent runs a short **build-type interview** — a handful
of plain questions: *What are you building? Who's it for? What does "done" look like?* — and from your
answers it drafts the requirements and the task list. It shows them back to you to confirm or correct
(this is a built-in checkpoint). Then `appbuilder plan compile <slug>` checks the plan is complete
and internally consistent.

**The human gate:** Nothing becomes real work until *you* approve the plan. Once you do,
`appbuilder plan seed <slug>` publishes the tasks to the shared queue. This is the first of the two
moments a person must say "yes."

**What you end up with:** A folder describing the project (`requirements`, `architecture`, and a
`task-plan`), and a queue of approved, ready-to-pick-up tasks.

### Phase 2 — Scaffold: lay the foundation

**What it's for:** To generate the boring starter files every project of its type needs, so no one
writes them by hand.

**What you do:** Run `appbuilder scaffold <slug>`. Based on the *build type* you chose during
planning (a CLI tool, a library, an app, or a game), the tool copies the matching **template** into a
fresh project workspace and fills in the project's name where needed. (`appbuilder templates` lists
the available starter kits.)

**What the tool produces:** A complete starter project plus a *scaffold report* recording exactly
what it generated.

**What you end up with:** A framed-out project ready for real code — and the proof (the report) that
the foundation was laid.

### Phase 3 — Build: write the code, one task at a time

**What it's for:** To actually implement the project, task by task, with a clear record of what each
task touched.

**What you do:** This phase pairs with the **per-task loop** (the small diagram in §4). For each task,
an agent **claims** it (locking it so no one else collides), writes the code — **test-first**, meaning
the automated check is written *before* the code that satisfies it — and records progress. Behind the
scenes, `appbuilder build init` lays out a checklist of the plan's tasks, the agent marks each one
done (or deliberately skipped, with a reason), and `appbuilder build <slug>` verifies the checklist
honestly matches what's on disk: every "done" task really produced files, nothing was quietly dropped,
and the scaffold wasn't broken.

**What the tool checks:** That the work declared actually exists and lines up with the approved plan.
If it doesn't, the gate fails and explains why.

**What you end up with:** Finished code plus a *build report* summarizing what was done.

### Phase 4 — Test: prove it actually works

**What it's for:** To confirm the project's own automated tests genuinely pass — not just that someone
*says* they pass.

**What you do:** Run `appbuilder test <slug>`. This is the first phase where the tool *runs something*
rather than only checking declarations: it executes the project's own test suite and reads the
results.

**What the tool checks:** That at least one test ran and **zero** tests failed. (A project that
"passes" with no tests at all is treated as a failure — you can't green-light nothing.)

**What you end up with:** A *test report* with the exact pass/fail counts. Its existence means the
project really passed its tests.

### Phase 5 — Review: a human reads and judges  ‖ *(second human gate)*

**What it's for:** To put a person's eyes on the finished work before it's accepted.

**What you do:** `appbuilder review init <slug>` creates a short review document with sections to fill
in — a summary, any findings, and a checklist. A reviewer writes their honest assessment and sets the
verdict to either **approved** or **changes requested**. Then `appbuilder review <slug>` confirms the
review is complete and the verdict is *approved*.

**The human gate:** This is the second and final moment a person must say "yes." Work that isn't
approved cannot ship.

**What you end up with:** A written, signed-off review — the record that a human accepted the work.

> The per-task work from Phase 3 is also folded into the project here, through a **pull request** that
> a human reviews and merges. That merge is the same "second gate" in practice: nothing enters the
> real project without a person approving it.

### Phase 6 — Ship: the final check and the go-live list

**What it's for:** To make one last, whole-chain check and hand you a clear checklist for going live.

**What you do:** Run `appbuilder ship <slug>`. Unlike the earlier gates, ship re-verifies the
*entire* chain at once: the scaffold, build, and test reports must all be present, and the review must
be approved. If anything is missing or unapproved, it lists every problem and writes nothing.

**What the tool produces:** On success, a *ship checklist* — a single page summarizing what was built
and tested, listing all the artifacts, and offering a set of **manual go-live steps** (tag the
release, update the changelog, deploy, announce). Those steps are reminders for *you*; the tool
doesn't perform them, and it won't overwrite your checklist (and your progress ticking those boxes)
unless you explicitly ask it to.

**What you end up with:** A finished, fully-vetted project and a checklist to carry it over the
finish line. 🚀

---

## 7. A real example, start to finish

Let's build a tiny command-line tool called **word-counter** that counts the words in a piece of
text. Here's the whole journey, with what comes back at each step.

1. **Plan it.**
   `appbuilder plan new word-counter` creates the project folder. An agent interviews you — "A
   command-line tool? What's the core job? Count words in input text. What does done look like? It
   prints a number." — and drafts the requirements and a couple of tasks (e.g. *TASK-001: read input
   and count words*, *TASK-002: handle empty input*). You read the draft and confirm it.
   `appbuilder plan compile word-counter` says everything's consistent. **You approve**, and
   `appbuilder plan seed word-counter` puts the two tasks on the queue.

2. **Lay the foundation.**
   `appbuilder scaffold word-counter` sees this is a `cli`-type project and generates a working
   command-line skeleton — a starter program and a starter test — into the project workspace. You get
   a scaffold report listing what it made.

3. **Build it.**
   An agent claims `TASK-001`, writes a test that says "three words in, the answer is 3," then writes
   the code that makes that test pass. It records the task as done. `appbuilder build word-counter`
   confirms the work matches the plan and writes a build report.

4. **Test it.**
   `appbuilder test word-counter` runs the project's tests. They pass — say, 2 passed, 0 failed — and
   a test report is written.

5. **Review it.**
   `appbuilder review init word-counter` opens a review note. You read the code, write "Counts words
   correctly, handles empty input, tests are meaningful," and set the verdict to **approved**.
   `appbuilder review word-counter` confirms it.

6. **Ship it.**
   `appbuilder ship word-counter` re-checks the whole chain — scaffold ✓, build ✓, test ✓, review
   approved ✓ — and writes a ship checklist with the summary, the file list, and the go-live steps.
   word-counter is done. 🚀

Each arrow forward only happened because the previous step left its proof on disk. That's the whole
discipline in action.

---

## 8. Everything the tool can do (capability catalog)

Every command, in human terms. (For exact syntax and options, see [README.md](README.md).)

**Getting set up and checking health**

| Command | What it's for |
| --- | --- |
| `doctor` | Health-check the workbench — confirms everything is wired up correctly. |
| `init-coordination` | One-time setup of the shared space where tasks and handoffs live. |
| `status` | Show what's being worked on, what's stuck, and what's dangling. |
| `events` | Show the history of coordination activity, drawn from the project's record. |

**Planning a project**

| Command | What it's for |
| --- | --- |
| `plan new <slug>` | Start a new project — create the empty plan files to fill in. |
| `plan compile <slug>` | Check the plan is complete and internally consistent. |
| `plan seed <slug>` | After you approve, publish the plan's tasks to the shared queue. |
| `templates` | List the available starter kits (cli, library, app, game). |

**Building, testing, reviewing, shipping**

| Command | What it's for |
| --- | --- |
| `scaffold <slug>` | Generate the starter files for the project from its template. |
| `build init <slug>` | Lay out the checklist of tasks to implement. |
| `build <slug>` | Verify the finished work honestly matches the plan and files on disk. |
| `test <slug>` | Run the project's own tests and confirm they pass. |
| `review init <slug>` | Open a review note for a person to fill in. |
| `review <slug>` | Confirm the review is complete and the verdict is *approved*. |
| `ship <slug>` | Re-check the whole chain and produce the go-live checklist. |

**Coordinating who works on what** (the per-task loop)

| Command | What it's for |
| --- | --- |
| `claim <task>` | Lock a task so you're the only one working on it. |
| `handoff` | Record what you did on a task and whether the tests passed. |
| `ready <task>` | Final pre-merge check that the task is truly finished and safe. |
| `release <task>` | Return the task's "key" once it's merged or abandoned. |

Many commands take an optional `--force` to deliberately redo something they'd otherwise protect (for
example, regenerating a checklist you've already started ticking). The tool always errs on the side
of *not* destroying your work unless you say so.

---

## 9. The safety rails

A few simple rules keep the whole system trustworthy. They're summarized here in plain language; the
complete, authoritative set lives in [AGENTS.md](AGENTS.md) and [.agent/rules/](.agent/rules/).

- **Claim before you touch anything.** You can't edit a task someone else has locked.
- **Never work directly on the finished project.** All changes arrive through a pull request a human
  reviews — so the project's main line is never changed without approval.
- **A human approves twice:** the plan before it becomes work, and every change before it's accepted.
- **No secrets, no reckless commands.** The tool checks for accidentally-committed secrets and won't
  run destructive actions without explicit permission.
- **Report honestly.** Failures are reported with the real output; partial work is never dressed up as
  finished.
- **Advise before building.** A good agent tells you when a request is a bad idea, or when something
  already does the job, *before* charging ahead.

---

## 10. Where to go next

| Document | What it gives you |
| --- | --- |
| **This guide** | The big picture, in plain language — what it is and how the whole thing works. |
| [README.md](README.md) | The quick command reference: exact commands, options, and what each one writes. |
| [HOWTO.md](HOWTO.md) | The detailed operator's manual: every phase step by step, with failure-fix tables. |
| [AGENTS.md](AGENTS.md) + [.agent/rules/](.agent/rules/) | The charter and detailed rules for AI agents working in the repo. |
| [templates/README.md](templates/README.md) | How to author a new starter kit (build type). |

That's the whole workbench. An idea goes in; a tested, reviewed, shippable project comes out — with a
clear paper trail and a person in control at the two moments that matter.
