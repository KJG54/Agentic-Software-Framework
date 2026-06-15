"use strict";

// The planning flow: scaffold a project's artifacts (plan new), validate requirements +
// task plan for readiness (plan compile), and publish the plan's tasks to the coordination
// queue (plan seed). compilePlan is the shared gate seed reuses so nothing is published
// until compile passes.

const fs = require("fs");
const path = require("path");
const { readJson, writeJson, writeText } = require("./util");
const {
  loadProject,
  validateQueueTask,
  validateRequirements,
  validateTaskPlan,
  validateStackDecision
} = require("./validate");
const { ensureCoordinationWorktree, commitIfChanged, maybePush } = require("./coordination");

function plan(cwd, args) {
  const sub = args[0];
  const slug = args[1];
  if (!["new", "compile", "seed"].includes(sub)) {
    throw new Error("Usage: appbuilder plan <new|compile|seed> <project-slug>");
  }
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Provide a project slug (lowercase letters, digits, hyphens): appbuilder plan ${sub} <project-slug>`);
  }
  const project = loadProject(cwd);
  if (sub === "new") return planNew(project, slug);
  if (sub === "compile") return planCompile(project, slug);
  return planSeed(project, slug);
}

function projectPlanDir(project, slug) {
  return path.join(project.root, project.config.projects_dir, slug);
}

function planNew(project, slug) {
  const dir = projectPlanDir(project, slug);
  const requirementsPath = path.join(dir, "requirements.json");
  if (fs.existsSync(requirementsPath)) {
    throw new Error(`Project plan already exists: ${path.relative(project.root, requirementsPath)}. Refusing to overwrite.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  writeJson(requirementsPath, {
    schema_version: "1.0",
    project: slug,
    summary: "",
    goals: [],
    features: [],
    constraints: []
  });
  writeJson(path.join(dir, "task-plan.json"), {
    schema_version: "1.0",
    project: slug,
    tasks: []
  });
  writeJson(path.join(dir, "stack-decision.json"), {
    schema_version: "1.0",
    project: slug,
    recommended_stack: "",
    rationale: "",
    tradeoffs: [],
    alternatives_considered: [],
    human_decision_needed: false
  });
  writeText(path.join(dir, "architecture.md"), buildArchitectureStub(slug));
  console.log(`created plan for ${slug}`);
  console.log(`project_dir=${path.relative(project.root, dir)}`);
  console.log(`next: fill requirements.json, author task-plan.json, then appbuilder plan compile ${slug}`);
  return 0;
}

function buildArchitectureStub(slug) {
  return `---
schema_version: "1.0"
project: ${slug}
---

# Architecture: ${slug}

## Overview

_Describe the high-level architecture here._

## Components

_List the major components and their responsibilities._

## Decisions

_Record key technical decisions._
`;
}

function compilePlan(project, slug) {
  const dir = projectPlanDir(project, slug);
  const requirementsPath = path.join(dir, "requirements.json");
  const taskPlanPath = path.join(dir, "task-plan.json");
  if (!fs.existsSync(requirementsPath)) {
    return { ok: false, lines: [`fail compile: project not found: ${slug} (run appbuilder plan new ${slug})`] };
  }
  const failures = [];
  const requirements = readJson(requirementsPath);
  const taskPlan = fs.existsSync(taskPlanPath) ? readJson(taskPlanPath) : null;

  const reqValidation = validateRequirements(requirements, project.root);
  if (!reqValidation.ok) failures.push(...reqValidation.errors.map((error) => `requirements: ${error}`));
  if (!String(requirements.summary || "").trim()) failures.push("requirements: summary must be non-empty");
  if (!Array.isArray(requirements.goals) || requirements.goals.length === 0) failures.push("requirements: goals must be non-empty");
  if (!Array.isArray(requirements.features) || requirements.features.length === 0) {
    failures.push("requirements: features must be non-empty");
  } else {
    requirements.features.forEach((feature, index) => {
      if (!feature || !String(feature.name || "").trim()) failures.push(`requirements: features[${index}].name must be non-empty`);
    });
  }

  if (!taskPlan) {
    failures.push(`task-plan: not found: ${slug}/task-plan.json`);
  } else {
    const planValidation = validateTaskPlan(taskPlan, project.root);
    if (!planValidation.ok) failures.push(...planValidation.errors.map((error) => `task-plan: ${error}`));
    const tasks = Array.isArray(taskPlan.tasks) ? taskPlan.tasks : [];
    if (tasks.length === 0) failures.push("task-plan: tasks must be non-empty");
    const ids = new Set();
    for (const task of tasks) {
      const taskValidation = validateQueueTask(task, project.root);
      if (!taskValidation.ok) failures.push(...taskValidation.errors.map((error) => `task-plan task ${task && task.id ? task.id : "?"}: ${error}`));
      if (task && task.id) {
        if (ids.has(task.id)) failures.push(`task-plan: duplicate task id ${task.id}`);
        ids.add(task.id);
      }
    }
    for (const task of tasks) {
      for (const dependency of (task && task.depends_on) || []) {
        if (!ids.has(dependency)) failures.push(`task-plan: ${task.id} depends_on ${dependency} which is not in the plan`);
      }
    }
  }

  // Stack-decision checkpoint (spec Checkpoint 3): a recommended stack with its tradeoffs and
  // alternatives must exist before the human approval gate, so the choice is explicit and
  // reviewable rather than buried in architecture.md prose.
  const stackPath = path.join(dir, "stack-decision.json");
  if (!fs.existsSync(stackPath)) {
    failures.push(`stack-decision: not found: ${slug}/stack-decision.json (run appbuilder plan new ${slug})`);
  } else {
    const stackDecision = readJson(stackPath);
    const stackValidation = validateStackDecision(stackDecision, project.root);
    if (!stackValidation.ok) failures.push(...stackValidation.errors.map((error) => `stack-decision: ${error}`));
    if (!String(stackDecision.recommended_stack || "").trim()) {
      failures.push("stack-decision: recommended_stack must be non-empty");
    }
  }

  if (failures.length) return { ok: false, lines: failures.map((failure) => `fail ${failure}`), requirements, taskPlan };
  return { ok: true, lines: [], requirements, taskPlan };
}

function planCompile(project, slug) {
  const result = compilePlan(project, slug);
  for (const line of result.lines) console.log(line);
  if (!result.ok) return 1;
  console.log(`ok compile: ${slug} passed`);
  return 0;
}

function planSeed(project, slug) {
  const result = compilePlan(project, slug);
  if (!result.ok) {
    for (const line of result.lines) console.log(line);
    console.log("fail seed: compile must pass before seeding");
    return 1;
  }
  console.log("ok compile: passed");
  const worktree = ensureCoordinationWorktree(project);
  const queueDir = path.join(worktree, "coordination", "queue");
  fs.mkdirSync(queueDir, { recursive: true });
  let published = 0;
  for (const task of result.taskPlan.tasks) {
    const target = path.join(queueDir, `${task.id}.json`);
    if (fs.existsSync(target)) {
      console.log(`skip seed: ${task.id} already exists`);
      continue;
    }
    writeJson(target, normalizeQueueTask(task));
    console.log(`ok seed: ${task.id} published`);
    published += 1;
  }
  if (published === 0) {
    console.log("ok coordination: nothing new to publish");
    return 0;
  }
  const committed = commitIfChanged(worktree, `coordination: seed ${published} task(s) from plan ${slug}`);
  if (committed) maybePush(worktree, project.config.coordination_branch);
  console.log(committed ? "ok coordination: committed" : "ok coordination: nothing new to publish");
  return 0;
}

function normalizeQueueTask(task) {
  const normalized = {
    schema_version: "1.0",
    id: task.id,
    title: task.title,
    description: task.description || "",
    depends_on: task.depends_on || [],
    files_touched_estimate: task.files_touched_estimate || [],
    acceptance_criteria: task.acceptance_criteria || []
  };
  if (task.branch) normalized.branch = task.branch;
  return normalized;
}

module.exports = {
  plan,
  compilePlan
};
