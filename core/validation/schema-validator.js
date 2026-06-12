"use strict";

const fs = require("fs");
const path = require("path");

function validateJsonArtifact(root, schemaName, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: [`${schemaName}: artifact must be an object`] };
  }
  const schemaVersion = value.schema_version;
  if (!schemaVersion) return { ok: false, errors: [`${schemaName}: missing schema_version`] };
  return validateByVersion(root, schemaName, schemaVersion, value);
}

function validateMarkdownArtifact(root, schemaName, frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return { ok: false, errors: [`${schemaName}: missing frontmatter object`] };
  }
  const schemaVersion = frontmatter.schema_version;
  if (!schemaVersion) return { ok: false, errors: [`${schemaName}: missing schema_version`] };
  return validateByVersion(root, schemaName, schemaVersion, frontmatter);
}

function validateByVersion(root, schemaName, schemaVersion, value) {
  const schemaPath = schemaPathFor(root, schemaName, schemaVersion);
  if (!fs.existsSync(schemaPath)) {
    return { ok: false, errors: [`${schemaName}: no schema found for schema_version ${schemaVersion} at ${schemaPath}`] };
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const errors = validateAgainstSchema(schema, value, "$");
  return { ok: errors.length === 0, errors };
}

function schemaPathFor(root, schemaName, schemaVersion) {
  const versionDir = `v${String(schemaVersion).split(".")[0]}`;
  return path.join(root, "contracts", "schemas", versionDir, `${schemaName}.schema.json`);
}

function validateAgainstSchema(schema, value, location) {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;

  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    errors.push(`${location}: expected constant ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${location}: expected one of ${schema.enum.join(", ")}`);
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${location}: expected type ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}`);
    return errors;
  }

  if (schema.type === "object" || (schema.properties && isPlainObject(value))) {
    if (!isPlainObject(value)) {
      errors.push(`${location}: expected object`);
      return errors;
    }
    for (const field of schema.required || []) {
      if (value[field] === undefined) errors.push(`${location}.${field}: required field missing`);
    }
    for (const [field, childValue] of Object.entries(value)) {
      const childSchema = schema.properties ? schema.properties[field] : null;
      if (!childSchema) {
        if (schema.additionalProperties === false) errors.push(`${location}.${field}: additional property is not allowed`);
        continue;
      }
      errors.push(...validateAgainstSchema(childSchema, childValue, `${location}.${field}`));
    }
  }

  if (schema.type === "array" || (schema.items && Array.isArray(value))) {
    if (!Array.isArray(value)) {
      errors.push(`${location}: expected array`);
      return errors;
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateAgainstSchema(schema.items, item, `${location}[${index}]`));
      });
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: expected at least ${schema.minLength} characters`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${location}: does not match ${schema.pattern}`);
    }
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${location}: expected date-time`);
    }
  }

  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${location}: expected minimum ${schema.minimum}`);
  }

  return errors;
}

function matchesType(value, type) {
  if (Array.isArray(type)) return type.some((item) => matchesType(value, item));
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  validateJsonArtifact,
  validateMarkdownArtifact,
  validateByVersion,
  validateAgainstSchema,
  schemaPathFor
};
