"use strict";

// Dependency-free primitives shared across the CLI modules: path/root discovery,
// JSON/text IO, slugging, and a filesystem walker. Keeping these here lets git.js,
// validate.js, coordination.js, and plan.js stay free of circular requires.

const fs = require("fs");
const path = require("path");

const ROOT_CONFIG = "appbuilder.json";
const COORD_WORKTREE = path.join(".appbuilder", "coordination-worktree");
const TASK_ID_RE = /^TASK-\d{3,}$/;

function findRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ROOT_CONFIG))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON ${file}: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function slug(value) {
  return String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function walk(root, options = {}) {
  const skip = new Set(options.skip || []);
  const found = [];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(full);
    }
  }
  visit(root);
  return found;
}

module.exports = {
  ROOT_CONFIG,
  COORD_WORKTREE,
  TASK_ID_RE,
  findRoot,
  readJson,
  writeJson,
  writeText,
  slug,
  normalizePath,
  walk
};
