"use strict";

// Thin wrappers over the git CLI. Every coordination operation goes through git()
// so failures surface with the command that produced them. No internal deps.

const { spawnSync } = require("child_process");

function git(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe"
  });
  if (result.error) {
    if (options.allowFail) return result;
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`git ${args.join(" ")} failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function isGitRepo(root) {
  return git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }).status === 0;
}

function hasAnyCommit(root) {
  return git(root, ["rev-parse", "--verify", "HEAD"], { allowFail: true }).status === 0;
}

function currentBranch(root) {
  const result = git(root, ["branch", "--show-current"], { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function branchExists(root, branch) {
  return git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFail: true }).status === 0;
}

function remoteBranchExists(root, branch) {
  return git(root, ["ls-remote", "--exit-code", "--heads", "origin", branch], { allowFail: true }).status === 0;
}

function hasRemote(root) {
  return git(root, ["remote", "get-url", "origin"], { allowFail: true }).status === 0;
}

module.exports = {
  git,
  isGitRepo,
  hasAnyCommit,
  currentBranch,
  branchExists,
  remoteBranchExists,
  hasRemote
};
