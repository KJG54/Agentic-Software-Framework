"use strict";

// Artifact validation seam. Every schema check funnels through validateJsonArtifact /
// validateMarkdownArtifact here, so a future validator swap (e.g. AJV) has one place to
// change. Also owns loadProject (load + validate the root config) and the frontmatter
// parser the markdown artifacts depend on.

const fs = require("fs");
const path = require("path");
const {
  validateJsonArtifact,
  validateMarkdownArtifact
} = require("../../core/validation/schema-validator");
const { ROOT_CONFIG, findRoot, readJson } = require("./util");

function validationRoot(root) {
  return root || findRoot(process.cwd()) || path.resolve(__dirname, "..", "..");
}

function validateAppbuilderConfig(config, root) {
  return validateJsonArtifact(validationRoot(root), "appbuilder-config", config);
}

function validateQueueTask(task, root) {
  return validateJsonArtifact(validationRoot(root), "queue-task", task);
}

function validateClaim(claimFile, root) {
  const claim = typeof claimFile === "string" ? readJson(claimFile) : claimFile;
  const result = validateJsonArtifact(validationRoot(root), "claim", claim);
  return { ...result, claim };
}

function validateRegistryEntry(entry, root) {
  return validateJsonArtifact(validationRoot(root), "registry", entry);
}

function validateRequirements(doc, root) {
  return validateJsonArtifact(validationRoot(root), "requirements", doc);
}

function validateTaskPlan(doc, root) {
  return validateJsonArtifact(validationRoot(root), "task-plan", doc);
}

function validateScaffoldReport(report, root) {
  return validateJsonArtifact(validationRoot(root), "scaffold-report", report);
}

function validateBuildManifest(manifest, root) {
  return validateJsonArtifact(validationRoot(root), "build-manifest", manifest);
}

function validateBuildReport(report, root) {
  return validateJsonArtifact(validationRoot(root), "build-report", report);
}

function validateTestReport(report, root) {
  return validateJsonArtifact(validationRoot(root), "test-report", report);
}

function validateReviewReport(frontmatter, root) {
  return validateMarkdownArtifact(validationRoot(root), "review-report", frontmatter);
}

function validateShipChecklist(frontmatter, root) {
  return validateMarkdownArtifact(validationRoot(root), "ship-checklist", frontmatter);
}

function validateAdr(frontmatter, root) {
  return validateMarkdownArtifact(validationRoot(root), "adr", frontmatter);
}

function validateInternalToolRegistry(registry, root) {
  const result = validateJsonArtifact(validationRoot(root), "internal-tool-registry", registry);
  const errors = [...result.errors];
  // The schema validator has no minItems; a registry only does its job when it is non-empty.
  if (Array.isArray(registry.tools) && registry.tools.length === 0) {
    errors.push("tools must not be empty");
  }
  return { ok: errors.length === 0, errors };
}

function validateHandoff(file, root) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = parseFrontmatter(text);
  if (!parsed) return { ok: false, errors: ["Missing YAML frontmatter"] };
  const data = parsed.data;
  const result = validateMarkdownArtifact(validationRoot(root), "handoff", data);
  const errors = [...result.errors];
  if (data.status === "blocked" && (!Array.isArray(data.blockers) || data.blockers.length === 0)) {
    errors.push("blocked handoffs require blockers");
  }
  return { ok: errors.length === 0, errors, data };
}

function parseFrontmatter(text) {
  // Accept both LF and CRLF openings: git autocrlf rewrites checked-out files
  // to CRLF on Windows, which must not hide the frontmatter from doctor.
  if (!/^---\r?\n/.test(text)) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const yaml = text.slice(4, end).trim();
  const data = {};
  let currentList = null;
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (line.trimStart().startsWith("- ") && currentList) {
      data[currentList].push(unquote(line.trimStart().slice(2).trim()));
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (rawValue === "[]") {
      data[key] = [];
      currentList = key;
    } else if (rawValue === "") {
      data[key] = [];
      currentList = key;
    } else if (rawValue === "true" || rawValue === "false") {
      data[key] = rawValue === "true";
      currentList = null;
    } else {
      data[key] = unquote(rawValue);
      currentList = null;
    }
  }
  return { data };
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadProject(cwd) {
  const root = findRoot(cwd);
  if (!root) throw new Error(`Could not find ${ROOT_CONFIG}. Run from an App Builder project.`);
  const configPath = path.join(root, ROOT_CONFIG);
  const config = readJson(configPath);
  const validation = validateAppbuilderConfig(config, root);
  if (!validation.ok) {
    throw new Error(`${ROOT_CONFIG} is invalid:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  return { root, config };
}

module.exports = {
  validationRoot,
  validateAppbuilderConfig,
  validateQueueTask,
  validateClaim,
  validateRegistryEntry,
  validateRequirements,
  validateTaskPlan,
  validateScaffoldReport,
  validateBuildManifest,
  validateBuildReport,
  validateTestReport,
  validateReviewReport,
  validateShipChecklist,
  validateAdr,
  validateInternalToolRegistry,
  validateHandoff,
  parseFrontmatter,
  unquote,
  loadProject
};
