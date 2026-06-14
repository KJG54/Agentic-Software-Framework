"use strict";

// The `templates` command: discover what build-type templates are available to scaffold.
// The templates/ directory is the single source of truth — a template is any templates/<id>/
// with a readable template.json manifest. Adding one is a one-folder change; this command
// surfaces the live list (replacing the old hardcoded build_type enum as the answer to
// "what can I scaffold?").

const fs = require("fs");
const path = require("path");
const { readJson } = require("./util");
const { loadProject } = require("./validate");

// Scan templates/*/template.json and return one entry per valid manifest. Non-directories
// (e.g. .gitkeep) and malformed/unreadable manifests are skipped — discovery never crashes.
function listTemplates(cwd) {
  const project = loadProject(cwd);
  const templatesDir = path.join(project.root, "templates");
  if (!fs.existsSync(templatesDir)) return [];
  const entries = [];
  for (const dirent of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(templatesDir, dirent.name, "template.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch {
      continue; // malformed manifest — skip, do not crash discovery
    }
    if (!manifest || typeof manifest !== "object") continue;
    entries.push({
      id: manifest.id || dirent.name,
      name: manifest.name || dirent.name,
      description: manifest.description || ""
    });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

// Human-readable by default (this is a discovery aid operators read); --json for scripts.
function templates(cwd, args = []) {
  const list = listTemplates(cwd);
  if (args.includes("--json")) {
    console.log(JSON.stringify(list, null, 2));
    return 0;
  }
  if (list.length === 0) {
    console.log("No templates found in templates/.");
    return 0;
  }
  console.log("Available build-type templates (build_type -> what scaffold renders):\n");
  for (const entry of list) {
    console.log(`  ${entry.id}  ${entry.name}`);
    if (entry.description) console.log(`      ${entry.description}`);
  }
  return 0;
}

module.exports = {
  listTemplates,
  templates
};
