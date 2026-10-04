#!/usr/bin/env node
// Checks this repository before it is published: the Claude Code marketplace and plugin manifests, the frontmatter of
// every skill, relative links and their anchors, links to the Tenantry docs, the writing conventions, and API names
// that Tenantry 0.7 removed. Needs Node.js 20 or later and nothing else.
//
//   node scripts/validate.mjs            offline checks
//   node scripts/validate.mjs --online   also requests every https://tenantry.dev link and fails on a non-200 answer
//
// The field lists follow https://code.claude.com/docs/en/plugins/marketplace-reference,
// https://code.claude.com/docs/en/plugins/manifest-reference and https://agentskills.io/specification.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const online = process.argv.includes('--online');
const errors = [];
const error = (file, message) => errors.push(`${relative(root, file) || '.'}: ${message}`);

// ---------------------------------------------------------------------------------------------------------------
// Manifests

const MARKETPLACE_FIELDS = new Set([
  '$schema', 'name', 'owner', 'plugins', 'description', 'version', 'metadata', 'forceRemoveDeletedPlugins',
  'allowCrossMarketplaceDependenciesOn', 'renames',
]);
const OWNER_FIELDS = new Set(['name', 'email', 'url']);
const PLUGIN_JSON_FIELDS = new Set([
  '$schema', 'name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license',
  'keywords', 'metadata', 'icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl',
  'defaultEnabled', 'dependencies', 'settings', 'userConfig', 'types', 'channels', 'skills', 'commands', 'agents',
  'hooks', 'mcpServers', 'lspServers', 'outputStyles', 'workflows', 'experimental',
]);
// An entry takes its own fields and every plugin.json field except the directory listing ones.
const DIRECTORY_LISTING_FIELDS = new Set(['icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']);
const ENTRY_FIELDS = new Set([
  'name', 'source', 'description', 'version', 'category', 'tags', 'strict', 'relevance', 'dependencies',
  'defaultEnabled', 'displayName', 'metadata', 'headers', 'headersHelper', 'themes',
  ...[...PLUGIN_JSON_FIELDS].filter((field) => !DIRECTORY_LISTING_FIELDS.has(field)),
]);
const RESERVED_MARKETPLACE_NAMES = new Set([
  'claude-code-marketplace', 'claude-code-plugins', 'claude-plugins-official', 'anthropic-marketplace',
  'anthropic-plugins', 'agent-skills', 'anthropic-agent-skills', 'life-sciences', 'knowledge-work-plugins',
  'claude-for-legal', 'claude-for-financial-services', 'financial-services-plugins', 'first-party-plugins',
  'claude-tag-plugins', 'claude-community', 'claude-plugins-community', 'healthcare', 'anthropic-plugin-directory',
  'claude-plugin-directory', 'inline', 'builtin', 'skills-dir', 'synced', 'claude-plugin-test', 'npm', 'pip', 'uv',
  'cargo', 'github', 'gh',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    error(file, `not valid JSON: ${e.message}`);
    return undefined;
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value) => typeof value === 'string' && value.length > 0;

function checkUnknownFields(file, object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) error(file, `${where}has an unknown field "${key}"`);
  }
}

function checkUrl(file, value, field) {
  if (value === undefined) return;
  try {
    new URL(value);
  } catch {
    error(file, `${field} is not a URL: ${value}`);
  }
}

function checkPerson(file, value, field) {
  if (value === undefined) return;
  if (!isObject(value) || !isString(value.name)) {
    error(file, `${field} must be an object with a name`);
    return;
  }
  checkUnknownFields(file, value, OWNER_FIELDS, `${field} `);
  checkUrl(file, value.url, `${field}.url`);
}

function checkPluginJson(file, expectedName) {
  const manifest = readJson(file);
  if (!isObject(manifest)) return [];
  checkUnknownFields(file, manifest, PLUGIN_JSON_FIELDS, '');
  if (!isString(manifest.name)) error(file, 'name is required');
  else {
    if (!KEBAB.test(manifest.name)) error(file, `name "${manifest.name}" is not kebab-case`);
    if (/^(claude|anthropic|anthropics|cc-plugin)-/i.test(manifest.name)) error(file, `name "${manifest.name}" is reserved`);
    if (expectedName && manifest.name !== expectedName) {
      error(file, `name "${manifest.name}" differs from the marketplace entry "${expectedName}"`);
    }
  }
  for (const field of ['displayName', 'description', 'repository', 'license']) {
    if (manifest[field] !== undefined && !isString(manifest[field])) error(file, `${field} must be a string`);
  }
  checkUrl(file, manifest.homepage, 'homepage');
  checkPerson(file, manifest.author, 'author');
  if (manifest.keywords !== undefined && !(Array.isArray(manifest.keywords) && manifest.keywords.every(isString))) {
    error(file, 'keywords must be an array of strings');
  }
  const skills = manifest.skills === undefined ? [] : [manifest.skills].flat();
  return skills;
}

function checkMarketplace() {
  const file = join(root, '.claude-plugin', 'marketplace.json');
  if (!existsSync(file)) {
    error(file, 'missing');
    return [];
  }
  const marketplace = readJson(file);
  if (!isObject(marketplace)) return [];
  checkUnknownFields(file, marketplace, MARKETPLACE_FIELDS, '');

  if (!isString(marketplace.name)) error(file, 'name is required');
  else if (!IDENTIFIER.test(marketplace.name) || marketplace.name.includes('..')) {
    error(file, `name "${marketplace.name}" may use only letters, digits, ".", "_" and "-", starting with a letter or digit`);
  } else if (RESERVED_MARKETPLACE_NAMES.has(marketplace.name.toLowerCase()) || /claude|anthropic/i.test(marketplace.name)) {
    error(file, `name "${marketplace.name}" is reserved or imitates an official marketplace`);
  }
  if (!isObject(marketplace.owner)) error(file, 'owner is required');
  else checkPerson(file, marketplace.owner, 'owner');
  if (!isString(marketplace.description)) error(file, 'description is missing');

  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    error(file, 'plugins must be a non-empty array');
    return [];
  }

  const plugins = [];
  const names = new Set();
  marketplace.plugins.forEach((entry, index) => {
    const where = `plugins[${index}] `;
    if (!isObject(entry)) {
      error(file, `${where}must be an object`);
      return;
    }
    checkUnknownFields(file, entry, ENTRY_FIELDS, where);
    if (!isString(entry.name) || !IDENTIFIER.test(entry.name)) error(file, `${where}needs a valid name`);
    else if (names.has(entry.name)) error(file, `${where}repeats the name "${entry.name}"`);
    names.add(entry.name);
    if (entry.tags !== undefined && !(Array.isArray(entry.tags) && entry.tags.every(isString))) {
      error(file, `${where}tags must be an array of strings`);
    }

    if (typeof entry.source !== 'string') {
      if (!isObject(entry.source)) error(file, `${where}needs a source`);
      return; // A remote source is fetched at install time; nothing local to check.
    }
    const source = entry.source;
    if (!source.startsWith('./') && source !== '.') error(file, `${where}source must start with "./"`);
    if (source.split('/').includes('..')) error(file, `${where}source must not contain ".."`);
    if (source.includes('\\')) error(file, `${where}source must use forward slashes`);
    const pluginRoot = resolve(root, source);
    if (!existsSync(pluginRoot) || !statSync(pluginRoot).isDirectory()) {
      error(file, `${where}source ${source} is not a directory`);
      return;
    }
    const pluginJson = join(pluginRoot, '.claude-plugin', 'plugin.json');
    let extraSkills = [];
    if (existsSync(pluginJson)) {
      extraSkills = checkPluginJson(pluginJson, entry.name);
      const manifest = readJson(pluginJson);
      if (isObject(manifest) && manifest.version !== undefined && entry.version !== undefined) {
        error(file, `${where}sets version, and so does ${relative(root, pluginJson)}: set it in one place, or neither`);
      }
    }
    plugins.push({ root: pluginRoot, skillDirs: ['./skills', ...extraSkills] });
  });
  return plugins;
}

// ---------------------------------------------------------------------------------------------------------------
// Skills (https://agentskills.io/specification)

const SKILL_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The frontmatter this repository writes: "key: value" lines, and a "metadata:" map of indented "key: value" lines.
// Anything else is reported, so the frontmatter stays valid YAML for every reader.
function parseFrontmatter(file, text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') {
    error(file, 'must start with a "---" frontmatter line');
    return undefined;
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    error(file, 'frontmatter has no closing "---"');
    return undefined;
  }
  const fields = {};
  let map;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const nested = /^ {2}([A-Za-z0-9_.-]+): (.+)$/.exec(line);
    if (nested && map) {
      map[nested[1]] = scalar(file, i + 1, nested[2]);
      continue;
    }
    const top = /^([A-Za-z0-9_-]+):(?: (.*))?$/.exec(line);
    if (!top) {
      error(file, `frontmatter line ${i + 1} is not "key: value": ${line}`);
      continue;
    }
    const [, key, value] = top;
    if (key in fields) error(file, `frontmatter repeats "${key}"`);
    if (value === undefined || value === '') {
      map = {};
      fields[key] = map;
    } else {
      map = undefined;
      fields[key] = scalar(file, i + 1, value);
    }
  }
  return { fields, bodyLines: lines.length - end - 1 };
}

function scalar(file, lineNumber, raw) {
  const value = raw.trim();
  if (/^".*"$/.test(value)) return value.slice(1, -1).replace(/\\"/g, '"');
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || value.includes(': ') || value.includes(' #') || value.endsWith(':')) {
    error(file, `frontmatter line ${lineNumber} needs quotes to be valid YAML: ${value}`);
  }
  return value;
}

function checkSkill(skillDir) {
  const file = join(skillDir, 'SKILL.md');
  const parsed = parseFrontmatter(file, readFileSync(file, 'utf8'));
  if (!parsed) return;
  const { fields, bodyLines } = parsed;
  checkUnknownFields(file, fields, SKILL_FIELDS, 'frontmatter ');

  const directory = skillDir.split(sep).pop();
  if (typeof fields.name !== 'string') error(file, 'name is required');
  else {
    if (fields.name.length > 64 || !SKILL_NAME.test(fields.name)) {
      error(file, `name "${fields.name}" must be 1 to 64 lower-case letters, digits and single hyphens`);
    }
    if (fields.name !== directory) error(file, `name "${fields.name}" must match its directory "${directory}"`);
  }
  if (typeof fields.description !== 'string' || fields.description.length === 0) error(file, 'description is required');
  else if (fields.description.length > 1024) error(file, `description is ${fields.description.length} characters; the limit is 1024`);
  if (fields.compatibility !== undefined && (typeof fields.compatibility !== 'string' || fields.compatibility.length > 500)) {
    error(file, 'compatibility must be a string of at most 500 characters');
  }
  if (fields.license !== undefined && typeof fields.license !== 'string') error(file, 'license must be a string');
  if (fields.metadata !== undefined && (!isObject(fields.metadata) || !Object.values(fields.metadata).every((v) => typeof v === 'string'))) {
    error(file, 'metadata must map string keys to string values');
  }
  if (bodyLines > 500) error(file, `body is ${bodyLines} lines; keep SKILL.md under 500`);
}

function checkSkills(plugins) {
  let count = 0;
  for (const plugin of plugins) {
    for (const dir of plugin.skillDirs) {
      const skillsRoot = resolve(plugin.root, dir);
      if (!existsSync(skillsRoot)) continue;
      for (const name of readdirSync(skillsRoot)) {
        const skillDir = join(skillsRoot, name);
        if (!statSync(skillDir).isDirectory()) continue;
        if (!existsSync(join(skillDir, 'SKILL.md'))) {
          error(skillDir, 'skill directory has no SKILL.md');
          continue;
        }
        checkSkill(skillDir);
        count++;
      }
    }
  }
  if (count === 0) errors.push('no skills found');
  return count;
}

// ---------------------------------------------------------------------------------------------------------------
// Markdown: links, anchors, old API names and the writing conventions

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else files.push(path);
  }
  return files;
}

// Text outside fenced code blocks, with line numbers, and inline code removed.
function prose(text) {
  const out = [];
  let fence;
  text.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence[0]) && marker[1].length >= fence.length) fence = undefined;
      return;
    }
    if (!fence) out.push({ number: index + 1, text: line.replace(/`[^`]*`/g, '``') });
  });
  return out;
}

// GitHub's heading anchors, as github-slugger makes them (the docs site uses the same): lower case, punctuation
// removed, spaces turned into hyphens, and repeats numbered.
function anchors(file) {
  const seen = new Map();
  const ids = new Set();
  let fence;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence[0]) && marker[1].length >= fence.length) fence = undefined;
      continue;
    }
    const heading = !fence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const slug = heading[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    ids.add(n === 0 ? slug : `${slug}-${n}`);
  }
  return ids;
}

// The docs pages the site serves (/docs/core/<page>, /docs/pro/<page>). With --core-docs and --pro-docs, each page and
// heading is checked against those docs folders instead: give them the docs of the release the skills target.
const CORE_PAGES = new Set([
  'index', 'access-control', 'ai-agents', 'analyzers', 'aot-and-trimming', 'aspnetcore-identity', 'aspnetcore-integration',
  'authentication-per-tenant', 'caching', 'changelog', 'compatibility', 'core-concepts', 'diagnostics',
  'efcore-advanced', 'efcore-integration', 'getting-started', 'http-propagation', 'migrating-from-finbuckle',
  'non-http-hosts', 'per-tenant-options', 'tenant-resolution', 'tenant-stores', 'testing', 'troubleshooting',
]);
const PRO_PAGES = new Set([
  'index', 'audit-logging', 'background-jobs', 'changelog', 'compatibility', 'database-per-tenant',
  'database-providers', 'getting-started', 'hangfire', 'health-checks', 'installation', 'licensing', 'masstransit',
  'migration-orchestration', 'mixed-mode', 'quartz', 'rebus', 'schema-per-tenant', 'telemetry', 'tenant-lifecycle',
  'testing', 'troubleshooting',
]);

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : resolve(process.argv[index + 1]);
}
const docsFolders = { core: option('--core-docs'), pro: option('--pro-docs') };
for (const [group, folder] of Object.entries(docsFolders)) {
  if (folder && !existsSync(folder)) errors.push(`--${group}-docs ${folder} does not exist`);
}

// Names that no longer exist (scripts/removed-names.txt).
const removedNames = readFileSync(join(root, 'scripts', 'removed-names.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.split('#')[0].trim())
  .filter((line) => line.length > 0)
  .map((line) => {
    const arrow = line.indexOf('=>');
    const name = (arrow === -1 ? line : line.slice(0, arrow)).trim();
    const replacement = arrow === -1 ? undefined : line.slice(arrow + 2).trim();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = name.startsWith('.') ? new RegExp(escaped) : new RegExp(`(?<![\\w.])${escaped}(?![\\w])`);
    return { name, replacement, pattern };
  });

function checkRemovedNames(file, line, number) {
  for (const { name, replacement, pattern } of removedNames) {
    if (pattern.test(line)) {
      error(file, `line ${number} names ${name}, which Tenantry 0.7 does not have${replacement ? `; use ${replacement}` : ''}`);
    }
  }
}

// Resolvers that read a value the caller chooses. A code block that registers one must also register an access
// validator, or any caller could act as any tenant; ResolveFromClaim and ResolveFromPropagationHeader read values the
// caller cannot choose.
const CALLER_CHOSEN = /\.(ResolveFromHeader|ResolveFromSubdomain|ResolveFromHost|ResolveFromRouteValue|ResolveFromQueryString|UseResolver)\b/;
const VALIDATOR = /\.ValidateTenantAccess(ByClaim)?\b/;

function codeBlocks(text) {
  const blocks = [];
  let block;
  text.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s*(```+|~~~+)\s*([^\s`]*)(.*)$/.exec(line);
    if (marker && !block) {
      block = { fence: marker[1], language: marker[2], meta: marker[3], start: index + 1, lines: [] };
    } else if (marker && marker[1].startsWith(block.fence[0]) && marker[1].length >= block.fence.length && marker[2] === '') {
      blocks.push(block);
      block = undefined;
    } else if (block) {
      block.lines.push(line);
    }
  });
  return blocks;
}

// The release the skills target, set once, in the workflow (TENANTRY_VERSION). Every dotnet add of a Tenantry package
// pins exactly that version.
const workflowFile = join(root, '.github', 'workflows', 'validate.yml');
const targetVersion = /^\s*TENANTRY_VERSION:\s*['"]?([^'"\s#]+)/m.exec(readFileSync(workflowFile, 'utf8'))?.[1];
if (!targetVersion) errors.push(`${relative(root, workflowFile)}: sets no TENANTRY_VERSION`);

const docsLinks = new Set();

function checkMarkdown(file) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.includes('\u2014')) error(file, `line ${index + 1} has an em dash`);
    checkRemovedNames(file, line, index + 1);
    // Unpinned, dotnet add package installs the newest release, which before 0.7.0 is 0.6, with isolation gaps.
    if (/\bdotnet add\b.*\bpackage Tenantry[\w.]*/.test(line)) {
      const pinned = /--version\s+([\w.*-]+)/.exec(line)?.[1];
      if (pinned !== targetVersion) {
        error(file, `line ${index + 1} adds a Tenantry package with ${pinned ? `--version ${pinned}` : 'no --version'}; ` +
          `pin --version ${targetVersion}, the workflow's TENANTRY_VERSION`);
      }
    }
  });

  for (const block of codeBlocks(text)) {
    if (!/^(csharp|cs|c#)$/i.test(block.language)) continue;
    const code = block.lines.join('\n');
    const resolver = CALLER_CHOSEN.exec(code);
    // A block whose own resolver checks the caller's access says so with ```csharp no-validator-needed.
    const optedOut = /(^|\s)no-validator-needed(\s|$)/.test(block.meta);
    if (resolver && !VALIDATOR.test(code) && !optedOut) {
      error(file, `line ${block.start}: the code block registers ${resolver[1]} and no access validator`);
    }
  }

  for (const { number, text: line } of prose(text)) {
    if (/^\s*(?:[-*+]|\d+\.)\s+\*\*[^*]+\*\*/.test(line)) error(file, `line ${number} starts a list item with a bold label`);

    for (const match of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) checkLink(file, number, match[1]);
    for (const match of line.matchAll(/https:\/\/tenantry\.dev\/docs[^\s)>`'"]*/g)) {
      checkDocsLink(file, number, match[0].replace(/[.,;:]+$/, ''));
    }
  }
}

function checkLink(file, number, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return; // https:, mailto: and the like
  const [path, anchor] = target.split('#');
  const destination = path === '' ? file : resolve(dirname(file), decodeURIComponent(path));
  if (!destination.startsWith(root)) {
    error(file, `line ${number} links outside the repository: ${target}`);
    return;
  }
  if (!existsSync(destination)) {
    error(file, `line ${number} links to a missing file: ${target}`);
    return;
  }
  if (anchor !== undefined && destination.endsWith('.md') && !anchors(destination).has(anchor)) {
    error(file, `line ${number} links to a missing heading: ${target}`);
  }
}

function checkDocsLink(file, number, url) {
  if (url === 'https://tenantry.dev/docs') return;
  const match = /^https:\/\/tenantry\.dev\/docs\/(core|pro)(?:\/([a-z0-9-]+))?\/?(?:#([a-z0-9-]+))?$/.exec(url);
  if (!match) {
    error(file, `line ${number} links to the docs outside /docs/core/<page> or /docs/pro/<page>: ${url}`);
    return;
  }
  const [, group, page = 'index', anchor] = match;
  docsLinks.add(url.split('#')[0]);
  const folder = docsFolders[group];
  if (!folder) {
    if (!(group === 'core' ? CORE_PAGES : PRO_PAGES).has(page)) {
      error(file, `line ${number} links to a docs page that does not exist: ${url}`);
    }
    return;
  }
  if (page === 'changelog') return; // made by the site from the releases' changelogs
  const source = join(folder, page === 'index' ? 'README.md' : `${page}.md`);
  if (!existsSync(source)) error(file, `line ${number} links to a docs page that ${folder} does not have: ${url}`);
  else if (anchor && !anchors(source).has(anchor)) error(file, `line ${number} links to a heading ${source} does not have: ${url}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Workflows: every action pinned to a full commit SHA

function checkWorkflows() {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const file = join(dir, name);
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const uses = /^\s*-?\s*uses:\s*["']?([^"'\s#]+)/.exec(line);
      if (uses && !uses[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(uses[1])) {
        error(file, `line ${index + 1} uses an action not pinned to a commit SHA: ${uses[1]}`);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------

const plugins = checkMarketplace();
const skillCount = checkSkills(plugins);
const files = walk(root);
for (const file of files.filter((f) => f.endsWith('.md'))) checkMarkdown(file);
for (const file of files.filter((f) => f.endsWith('.json'))) {
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (line.includes('\u2014')) error(file, `line ${index + 1} has an em dash`);
    checkRemovedNames(file, line, index + 1);
  });
}
checkWorkflows();

if (online) {
  for (const url of docsLinks) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (response.status !== 200) errors.push(`${url}: HTTP ${response.status}`);
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
const checkedAgainst = Object.entries(docsFolders).filter(([, folder]) => folder).map(([group]) => group);
console.log(`OK: ${plugins.length} plugin(s), ${skillCount} skill(s), ${files.filter((f) => f.endsWith('.md')).length} Markdown file(s), ` +
  `${docsLinks.size} docs page(s) linked${online ? ' and reachable' : ''}` +
  (checkedAgainst.length ? `, pages and headings checked against the ${checkedAgainst.join(' and ')} docs given.` :
    '; docs headings not checked (no --core-docs or --pro-docs).'));
