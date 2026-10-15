export const detectionPolicyVersion = 'part4-v1';

export type ManifestFormat = 'json' | 'lines' | 'xml' | 'toml' | 'yaml' | 'ruby';
export type FrameworkMarkerKind = 'json-package' | 'line-token' | 'xml-token' | 'toml-key' | 'yaml-key' | 'ruby-gem';

export interface FrameworkMarker {
  name: string;
  kind: FrameworkMarkerKind;
  tokens: readonly string[];
  reason: string;
}

export interface DetectionAdapterRule {
  id: string;
  languageFamily: string;
  language: string;
  sourceExtensions: readonly string[];
  manifestBasenames: readonly string[];
  manifestSuffixes?: readonly string[];
  manifestFormats: readonly ManifestFormat[];
  packageManagers: Readonly<Record<string, string>>;
  languageManifestReason: string;
  sourceReason: string;
  frameworkMarkers: readonly FrameworkMarker[];
  adapterAvailable: true;
}

const marker = (
  name: string,
  kind: FrameworkMarkerKind,
  tokens: readonly string[],
  reason = `dependency marker: ${name.toLowerCase()}`,
): FrameworkMarker => ({ name, kind, tokens, reason });

export const DETECTION_ADAPTER_RULES: readonly DetectionAdapterRule[] = [
  {
    id: 'javascript',
    languageFamily: 'javascript',
    language: 'JavaScript',
    sourceExtensions: ['.js', '.jsx', '.mjs', '.cjs'],
    manifestBasenames: ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'],
    manifestFormats: ['json', 'lines', 'yaml'],
    packageManagers: {
      'package-lock.json': 'npm',
      'npm-shrinkwrap.json': 'npm',
      'yarn.lock': 'yarn',
      'pnpm-lock.yaml': 'pnpm',
      'bun.lock': 'bun',
      'bun.lockb': 'bun',
    },
    languageManifestReason: 'repository manifest identifies a JavaScript project',
    sourceReason: 'source extension identifies JavaScript',
    frameworkMarkers: [
      marker('React', 'json-package', ['react', 'react-dom']),
      marker('Next.js', 'json-package', ['next']),
      marker('Vue', 'json-package', ['vue']),
      marker('Angular', 'json-package', ['@angular/core']),
      marker('Svelte', 'json-package', ['svelte']),
      marker('Express', 'json-package', ['express']),
      marker('Fastify', 'json-package', ['fastify']),
      marker('NestJS', 'json-package', ['@nestjs/core']),
      marker('Koa', 'json-package', ['koa']),
      marker('Electron', 'json-package', ['electron']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'typescript',
    languageFamily: 'javascript',
    language: 'TypeScript',
    sourceExtensions: ['.ts', '.tsx', '.mts', '.cts'],
    manifestBasenames: ['package.json', 'tsconfig.json', 'tsconfig.base.json'],
    manifestFormats: ['json'],
    packageManagers: {},
    languageManifestReason: 'repository manifest identifies a TypeScript project',
    sourceReason: 'source extension identifies TypeScript',
    frameworkMarkers: [],
    adapterAvailable: true,
  },
  {
    id: 'python',
    languageFamily: 'python',
    language: 'Python',
    sourceExtensions: ['.py', '.pyi'],
    manifestBasenames: ['requirements.txt', 'requirements-dev.txt', 'requirements-test.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'pipfile', 'pipfile.lock', 'poetry.lock', 'uv.lock', 'tox.ini'],
    manifestFormats: ['lines', 'toml', 'ruby'],
    packageManagers: {
      'requirements.txt': 'pip',
      'requirements-dev.txt': 'pip',
      'requirements-test.txt': 'pip',
      'pipfile': 'pipenv',
      'pipfile.lock': 'pipenv',
      'poetry.lock': 'poetry',
      'uv.lock': 'uv',
    },
    languageManifestReason: 'repository manifest identifies a Python project',
    sourceReason: 'source extension identifies Python',
    frameworkMarkers: [
      marker('Django', 'line-token', ['django']),
      marker('Flask', 'line-token', ['flask']),
      marker('FastAPI', 'line-token', ['fastapi']),
      marker('Celery', 'line-token', ['celery']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'jvm',
    languageFamily: 'jvm',
    language: 'Java',
    sourceExtensions: ['.java'],
    manifestBasenames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'gradlew', 'gradlew.bat'],
    manifestFormats: ['xml', 'lines', 'toml'],
    packageManagers: {
      'pom.xml': 'maven',
      'build.gradle': 'gradle',
      'build.gradle.kts': 'gradle',
      'settings.gradle': 'gradle',
      'settings.gradle.kts': 'gradle',
      'gradle.properties': 'gradle',
      'gradlew': 'gradle',
      'gradlew.bat': 'gradle',
    },
    languageManifestReason: 'repository manifest identifies a JVM project',
    sourceReason: 'source extension identifies Java',
    frameworkMarkers: [
      marker('Spring', 'line-token', ['org.springframework', 'spring-boot']),
      marker('Quarkus', 'line-token', ['io.quarkus']),
      marker('Micronaut', 'line-token', ['io.micronaut']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'kotlin',
    languageFamily: 'jvm',
    language: 'Kotlin',
    sourceExtensions: ['.kt', '.kts'],
    manifestBasenames: ['build.gradle', 'build.gradle.kts', 'settings.gradle.kts', 'pom.xml'],
    manifestFormats: ['xml', 'lines'],
    packageManagers: {
      'build.gradle.kts': 'gradle',
      'settings.gradle.kts': 'gradle',
      'pom.xml': 'maven',
    },
    languageManifestReason: 'repository manifest identifies a Kotlin project',
    sourceReason: 'source extension identifies Kotlin',
    frameworkMarkers: [],
    adapterAvailable: true,
  },
  {
    id: 'go',
    languageFamily: 'go',
    language: 'Go',
    sourceExtensions: ['.go'],
    manifestBasenames: ['go.mod', 'go.sum', 'go.work', 'go.work.sum'],
    manifestFormats: ['lines'],
    packageManagers: { 'go.mod': 'go', 'go.sum': 'go', 'go.work': 'go', 'go.work.sum': 'go' },
    languageManifestReason: 'repository manifest identifies a Go project',
    sourceReason: 'source extension identifies Go',
    frameworkMarkers: [
      marker('Gin', 'line-token', ['github.com/gin-gonic/gin']),
      marker('Echo', 'line-token', ['github.com/labstack/echo']),
      marker('Fiber', 'line-token', ['github.com/gofiber/fiber']),
      marker('Chi', 'line-token', ['github.com/go-chi/chi']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'php',
    languageFamily: 'php',
    language: 'PHP',
    sourceExtensions: ['.php'],
    manifestBasenames: ['composer.json', 'composer.lock'],
    manifestFormats: ['json', 'lines'],
    packageManagers: { 'composer.json': 'composer', 'composer.lock': 'composer' },
    languageManifestReason: 'repository manifest identifies a PHP project',
    sourceReason: 'source extension identifies PHP',
    frameworkMarkers: [
      marker('Laravel', 'json-package', ['laravel/framework']),
      marker('Symfony', 'json-package', ['symfony/framework-bundle', 'symfony/symfony']),
      marker('Slim', 'json-package', ['slim/slim']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'dotnet',
    languageFamily: 'dotnet',
    language: 'C#',
    sourceExtensions: ['.cs'],
    manifestBasenames: ['packages.config', 'global.json', 'nuget.config'],
    manifestSuffixes: ['.csproj', '.sln'],
    manifestFormats: ['xml', 'json', 'lines'],
    packageManagers: { 'packages.config': 'nuget', 'nuget.config': 'nuget', 'global.json': 'dotnet' },
    languageManifestReason: 'repository manifest identifies a .NET project',
    sourceReason: 'source extension identifies C#',
    frameworkMarkers: [
      marker('ASP.NET Core', 'xml-token', ['Microsoft.AspNetCore']),
      marker('Entity Framework', 'xml-token', ['Microsoft.EntityFrameworkCore']),
      marker('Blazor', 'xml-token', ['Microsoft.AspNetCore.Components']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'fsharp',
    languageFamily: 'dotnet',
    language: 'F#',
    sourceExtensions: ['.fs', '.fsx', '.fsi'],
    manifestBasenames: [],
    manifestSuffixes: ['.fsproj'],
    manifestFormats: ['xml'],
    packageManagers: {},
    languageManifestReason: 'repository manifest identifies an F# project',
    sourceReason: 'source extension identifies F#',
    frameworkMarkers: [],
    adapterAvailable: true,
  },
  {
    id: 'visual-basic',
    languageFamily: 'dotnet',
    language: 'Visual Basic',
    sourceExtensions: ['.vb'],
    manifestBasenames: [],
    manifestSuffixes: ['.vbproj'],
    manifestFormats: ['xml'],
    packageManagers: {},
    languageManifestReason: 'repository manifest identifies a .NET project',
    sourceReason: 'source extension identifies Visual Basic',
    frameworkMarkers: [],
    adapterAvailable: true,
  },
  {
    id: 'rust',
    languageFamily: 'rust',
    language: 'Rust',
    sourceExtensions: ['.rs'],
    manifestBasenames: ['cargo.toml', 'cargo.lock'],
    manifestFormats: ['toml', 'lines'],
    packageManagers: { 'cargo.toml': 'cargo', 'cargo.lock': 'cargo' },
    languageManifestReason: 'repository manifest identifies a Rust project',
    sourceReason: 'source extension identifies Rust',
    frameworkMarkers: [
      marker('Actix Web', 'toml-key', ['actix-web']),
      marker('Axum', 'toml-key', ['axum']),
      marker('Rocket', 'toml-key', ['rocket']),
      marker('Tokio', 'toml-key', ['tokio']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'dart',
    languageFamily: 'dart',
    language: 'Dart',
    sourceExtensions: ['.dart'],
    manifestBasenames: ['pubspec.yaml', 'pubspec.lock'],
    manifestFormats: ['yaml', 'lines'],
    packageManagers: { 'pubspec.yaml': 'pub', 'pubspec.lock': 'pub' },
    languageManifestReason: 'repository manifest identifies a Dart project',
    sourceReason: 'source extension identifies Dart',
    frameworkMarkers: [
      marker('Flutter', 'yaml-key', ['flutter']),
      marker('Flutter BLoC', 'yaml-key', ['flutter_bloc']),
      marker('Riverpod', 'yaml-key', ['riverpod', 'flutter_riverpod']),
    ],
    adapterAvailable: true,
  },
  {
    id: 'ruby',
    languageFamily: 'ruby',
    language: 'Ruby',
    sourceExtensions: ['.rb', '.rake'],
    manifestBasenames: ['gemfile', 'gemfile.lock', 'rakefile'],
    manifestSuffixes: ['.gemspec'],
    manifestFormats: ['ruby', 'lines'],
    packageManagers: { gemfile: 'bundler', 'gemfile.lock': 'bundler' },
    languageManifestReason: 'repository manifest identifies a Ruby project',
    sourceReason: 'source extension identifies Ruby',
    frameworkMarkers: [
      marker('Rails', 'ruby-gem', ['rails']),
      marker('Sinatra', 'ruby-gem', ['sinatra']),
      marker('Hanami', 'ruby-gem', ['hanami']),
    ],
    adapterAvailable: true,
  },
];

export function ruleMatchesBasename(rule: DetectionAdapterRule, basename: string): boolean {
  const lower = basename.toLowerCase();
  return rule.manifestBasenames.includes(lower) || (rule.manifestSuffixes?.some((suffix) => lower.endsWith(suffix)) ?? false);
}

export function sourceExtension(pathname: string): string {
  const basename = pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
  const dot = basename.lastIndexOf('.');
  return dot === -1 ? '' : basename.slice(dot);
}

export interface ParsedManifest {
  /** Empty for a platform-only manifest (JVM/.NET); source or plugin evidence is required. */
  languageIds: string[];
  family: string;
  dependencies: Set<string>;
  packageManager: string | null;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const pythonName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');

function dependencyKeys(value: unknown, fields: readonly string[]): Set<string> {
  const names = new Set<string>();
  if (object(value)) for (const field of fields) {
    if (!object(value[field])) continue;
    for (const [name, version] of Object.entries(value[field])) if (nonempty(version)) names.add(name.toLowerCase());
  }
  return names;
}

interface Token { value: string; kind: 'word' | 'string' | 'symbol' | 'newline' }

// A bounded lexical reader, not an interpreter. Quoted strings and comments stay
// opaque, so prose and commented-out declarations cannot become dependencies.
function lex(contents: string, style: 'toml' | 'code' | 'jsonc'): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < contents.length) {
    if (tokens.length >= 100_000) return null;
    const char = contents[i];
    if (char === '\n') { tokens.push({ value: '\n', kind: 'newline' }); i += 1; continue; }
    if (/\s/.test(char)) { i += 1; continue; }
    if ((char === '#' && style !== 'jsonc') || (contents.startsWith('//', i) && style !== 'toml')) {
      const end = contents.indexOf('\n', i);
      i = end < 0 ? contents.length : end;
      continue;
    }
    if (contents.startsWith('/*', i) && style !== 'toml') {
      const end = contents.indexOf('*/', i + 2);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const triple = style !== 'jsonc' && contents.startsWith(char.repeat(3), i);
      const delimiter = triple ? char.repeat(3) : char;
      i += delimiter.length;
      let value = '';
      let closed = false;
      while (i < contents.length) {
        if (contents.startsWith(delimiter, i)) { i += delimiter.length; closed = true; break; }
        if (contents[i] === '\\' && char === '"') {
          // Do not decode escape sequences into dependency names. They can only
          // make a literal unsupported, never create a matching marker.
          value += contents.slice(i, i + 2);
          i += 2;
        } else { value += contents[i]; i += 1; }
      }
      if (!closed) return null;
      tokens.push({ value, kind: 'string' });
      continue;
    }
    if ('[]{}=(),.:;'.includes(char)) { tokens.push({ value: char, kind: 'symbol' }); i += 1; continue; }
    const start = i;
    while (i < contents.length && !/[\s\[\]{}=(),.:;"']/.test(contents[i]) && contents[i] !== '#') i += 1;
    if (start === i) return null;
    tokens.push({ value: contents.slice(start, i), kind: 'word' });
  }
  return tokens;
}

interface TomlEntry { section: string[]; key: string; value: unknown; arrayTable: boolean }

function tomlEntries(contents: string): TomlEntry[] | null {
  const tokens = lex(contents, 'toml');
  if (!tokens) return null;
  let i = 0;
  let section: string[] = [];
  let arrayTable = false;
  const entries: TomlEntry[] = [];
  const lines = (): void => { while (tokens[i]?.kind === 'newline') i += 1; };
  const take = (value: string): boolean => { if (tokens[i]?.value !== value || tokens[i].kind !== 'symbol') return false; i += 1; return true; };
  const key = (): string[] => {
    const parts: string[] = [];
    do {
      const token = tokens[i++];
      if (!token || !['word', 'string'].includes(token.kind) || (token.kind === 'word' && !/^[A-Za-z0-9_-]+$/.test(token.value))) throw new Error('key');
      parts.push(token.value.toLowerCase());
    } while (take('.'));
    return parts;
  };
  const value = (depth = 0): unknown => {
    if (depth > 16) throw new Error('nesting');
    if (take('[')) {
      const values: unknown[] = [];
      lines();
      while (!take(']')) {
        values.push(value(depth + 1)); lines();
        if (take(']')) return values;
        if (!take(',')) throw new Error('array');
        lines();
      }
      return values;
    }
    if (take('{')) {
      const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      while (!take('}')) {
        const name = key().join('.');
        if (!take('=') || Object.hasOwn(values, name)) throw new Error('inline table');
        values[name] = value(depth + 1);
        if (take('}')) return values;
        if (!take(',')) throw new Error('inline table');
      }
      return values;
    }
    const token = tokens[i++];
    if (!token) throw new Error('value');
    if (token.kind === 'string') return token.value;
    if (token.kind === 'word' && /^(true|false|[+-]?\d[\d_-]*)$/.test(token.value)) return token.value === 'true' ? true : token.value === 'false' ? false : Number(token.value.replaceAll('_', ''));
    throw new Error('unsupported scalar');
  };
  try {
    while (i < tokens.length) {
      lines(); if (i >= tokens.length) break;
      if (take('[')) {
        arrayTable = take('[');
        section = key();
        if (!take(']') || (arrayTable && !take(']'))) return null;
      } else {
        const parts = key();
        if (!take('=')) return null;
        entries.push({ section: [...section, ...parts.slice(0, -1)], key: parts.at(-1)!, value: value(), arrayTable });
      }
      if (i < tokens.length && tokens[i].kind !== 'newline') return null;
    }
    return entries;
  } catch { return null; }
}

function requirementName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[A-Za-z0-9_,. -]+\])?\s*(?:(?:[<>=!~]{1,3}\s*[^\s#;]+(?:\s*,\s*[<>=!~]{1,3}\s*[^\s#;]+)*)|(?:@\s+\S+))?\s*(?:;[^\n]*)?(?:\s+#.*)?$/.exec(value);
  return match ? pythonName(match[1]) : null;
}

function pythonManifest(name: string, text: string): ParsedManifest | null {
  const dependencies = new Set<string>();
  const add = (value: unknown): void => { const dependency = requirementName(value); if (dependency) dependencies.add(dependency); };
  let valid = false;
  let manager: string | null = null;
  if (/^requirements(?:-(?:dev|test))?\.txt$/.test(name)) {
    for (const line of text.split(/\r?\n/)) add(line);
    valid = dependencies.size > 0; manager = 'pip';
  } else if (name === 'pyproject.toml' || name === 'pipfile' || name === 'poetry.lock' || name === 'uv.lock') {
    const entries = tomlEntries(text);
    if (!entries) return null;
    for (const entry of entries) {
      const section = entry.section.join('.');
      if ((section === 'project' || section === 'tool.poetry') && entry.key === 'name' && nonempty(entry.value)) valid = true;
      if ((section === 'project' && entry.key === 'dependencies') || section === 'project.optional-dependencies') {
        if (Array.isArray(entry.value)) { entry.value.forEach(add); valid = true; }
      }
      if (/^tool\.poetry\.(?:(?:group\.[^.]+\.)?dependencies|dev-dependencies)$/.test(section) || (name === 'pipfile' && ['packages', 'dev-packages'].includes(section))) {
        if (nonempty(entry.value) || (object(entry.value) && ['version', 'path', 'git', 'url', 'file'].some((key) => nonempty((entry.value as Record<string, unknown>)[key])))) { dependencies.add(pythonName(entry.key)); valid = true; }
      }
      if (section === 'build-system' && entry.key === 'requires' && Array.isArray(entry.value)) {
        const build = entry.value.map(requirementName);
        if (build.some((dep) => dep !== null && ['setuptools', 'poetry-core', 'hatchling', 'flit-core', 'pdm-backend', 'maturin'].includes(dep))) valid = true;
      }
      if (['poetry.lock', 'uv.lock'].includes(name) && entry.arrayTable && section === 'package' && entry.key === 'name' && nonempty(entry.value)) { dependencies.add(pythonName(entry.value)); valid = true; }
    }
    manager = name.startsWith('poetry') || entries.some((entry) => entry.section.slice(0, 2).join('.') === 'tool.poetry') ? 'poetry' : name === 'uv.lock' ? 'uv' : name === 'pipfile' ? 'pipenv' : null;
  } else if (name === 'setup.cfg') {
    let section = ''; let requirements = false;
    for (const line of text.split(/\r?\n/)) {
      const heading = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (heading) { section = heading[1].toLowerCase(); requirements = false; continue; }
      const assignment = /^([\w-]+)\s*=\s*(.*)$/.exec(line);
      if (assignment) {
        requirements = section === 'options' && assignment[1] === 'install_requires';
        if (requirements) { add(assignment[2]); valid = true; }
        if (section === 'metadata' && assignment[1] === 'name' && nonempty(assignment[2])) valid = true;
      } else if (requirements && /^\s+\S/.test(line)) add(line);
    }
  } else if (name === 'pipfile.lock') {
    try {
      const parsed: unknown = JSON.parse(text);
      for (const field of ['default', 'develop']) if (object(parsed) && object(parsed[field])) {
        for (const [key, value] of Object.entries(parsed[field])) if (object(value) && nonempty(value.version)) dependencies.add(pythonName(key));
      }
      valid = dependencies.size > 0; manager = 'pipenv';
    } catch { return null; }
  }
  return valid ? { languageIds: ['python'], family: 'python', dependencies, packageManager: manager } : null;
}

interface XmlNode { name: string; attributes: Record<string, string>; text: string; children: XmlNode[] }

function xmlTree(text: string): XmlNode | null {
  // No entities, DTDs, processing directives (apart from the XML declaration),
  // includes or network resolution. Accept only a small well-formed XML subset.
  text = text.replace(/^\s*<\?xml\s[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (/<!|<\?|&/.test(text)) return null;
  const root: XmlNode = { name: '', attributes: {}, text: '', children: [] };
  const stack = [root];
  const tokens = text.match(/<[^>]*>|[^<]+/g) ?? [];
  if (tokens.join('') !== text || tokens.length > 50_000) return null;
  for (const token of tokens) {
    const current = stack.at(-1)!;
    if (!token.startsWith('<')) { current.text += token; continue; }
    const close = /^<\/([\w:.-]+)\s*>$/.exec(token);
    if (close) { if (stack.length === 1 || current.name !== close[1].toLowerCase()) return null; stack.pop(); continue; }
    const tag = /^<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>$/.exec(token);
    if (!tag || stack.length > 64) return null;
    const node: XmlNode = { name: tag[1].toLowerCase(), attributes: Object.create(null) as Record<string, string>, text: '', children: [] };
    for (const attribute of tag[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attribute[1].toLowerCase();
      if (Object.hasOwn(node.attributes, key)) return null;
      node.attributes[key] = attribute[2] ?? attribute[3];
    }
    current.children.push(node);
    if (!tag[3]) stack.push(node);
  }
  return stack.length === 1 && root.children.length === 1 && root.text.trim() === '' ? root.children[0] : null;
}

function children(node: XmlNode, ...names: string[]): XmlNode[] {
  let nodes = [node];
  for (const name of names) nodes = nodes.flatMap((item) => item.children.filter((child) => child.name === name));
  return nodes;
}

function xmlManifest(name: string, text: string): ParsedManifest | null {
  const root = xmlTree(text);
  if (!root) return null;
  const dependencies = new Set<string>();
  const ids = new Set<string>();
  if (name === 'pom.xml') {
    if (root.name !== 'project') return null;
    const coordinate = (node: XmlNode): string => `${children(node, 'groupid')[0]?.text.trim() ?? ''}:${children(node, 'artifactid')[0]?.text.trim() ?? ''}`.toLowerCase();
    for (const node of children(root, 'dependencies', 'dependency')) dependencies.add(coordinate(node));
    for (const node of children(root, 'build', 'plugins', 'plugin')) {
      const plugin = coordinate(node);
      dependencies.add(plugin);
      if (plugin === 'org.jetbrains.kotlin:kotlin-maven-plugin') ids.add('kotlin');
      if (plugin === 'org.apache.maven.plugins:maven-compiler-plugin' || plugin === ':maven-compiler-plugin') ids.add('jvm');
    }
    if ([...dependencies].some((dep) => /^org\.jetbrains\.kotlin:kotlin-stdlib(?:-|$)/.test(dep))) ids.add('kotlin');
    return { languageIds: [...ids], family: 'jvm', dependencies, packageManager: 'maven' };
  }
  const language = name.endsWith('.fsproj') ? 'fsharp' : name.endsWith('.vbproj') ? 'visual-basic' : name.endsWith('.csproj') ? 'dotnet' : null;
  if (root.name === 'project' && language) {
    const sdk = root.attributes.sdk?.toLowerCase();
    if (sdk === 'microsoft.net.sdk.web') dependencies.add('microsoft.aspnetcore.app');
    if (sdk === 'microsoft.net.sdk.blazorwebassembly') dependencies.add('microsoft.aspnetcore.components');
    for (const item of children(root, 'itemgroup').flatMap((group) => group.children)) {
      if (['packagereference', 'frameworkreference'].includes(item.name) && nonempty(item.attributes.include)) dependencies.add(item.attributes.include.toLowerCase());
    }
    const hasTarget = children(root, 'propertygroup').some((group) => group.children.some((child) => ['targetframework', 'targetframeworks', 'targetframeworkversion'].includes(child.name) && nonempty(child.text)));
    return sdk || hasTarget || dependencies.size ? { languageIds: [language], family: 'dotnet', dependencies, packageManager: 'nuget' } : null;
  }
  if (name === 'packages.config' && root.name === 'packages') {
    for (const item of children(root, 'package')) if (nonempty(item.attributes.id) && nonempty(item.attributes.version)) dependencies.add(item.attributes.id.toLowerCase());
    return { languageIds: [], family: 'dotnet', dependencies, packageManager: 'nuget' };
  }
  return null;
}

function gradleManifest(text: string): ParsedManifest | null {
  const tokens = lex(text, 'code');
  if (!tokens) return null;
  const dependencies = new Set<string>();
  const ids = new Set<string>();
  const stack: string[] = [];
  const significant = tokens;
  for (let i = 0; i < significant.length; i += 1) {
    const token = significant[i];
    if (token.kind === 'symbol' && token.value === '{') { stack.push(significant[i - 1]?.kind === 'word' ? significant[i - 1].value : ''); continue; }
    if (token.kind === 'symbol' && token.value === '}') { if (stack.length === 0) return null; stack.pop(); continue; }
    if (stack.length !== 1 || token.kind !== 'word') continue;
    if (i > 0 && significant[i - 1].kind !== 'newline' && !['{', ';'].includes(significant[i - 1].value)) continue;
    const call = significant[i + 1]?.value === '(';
    const argument = call ? significant[i + 2] : significant[i + 1];
    if (call && significant[i + 3]?.value !== ')') continue;
    const afterArgument = significant[i + (call ? 4 : 2)];
    if (argument?.kind === 'string' && afterArgument && afterArgument.kind !== 'newline' && !['}', ';', 'version', 'apply'].includes(afterArgument.value)) continue;
    if (stack[0] === 'plugins') {
      let end = i + 1;
      while (end < significant.length && significant[end].kind !== 'newline' && ![';', '}'].includes(significant[end].value)) end += 1;
      if (significant.slice(i + 1, end).some((part, index, parts) => part.value === 'apply' && parts[index + 1]?.value === 'false')) continue;
      if (['java', '`java-library`'].includes(token.value) && (argument?.kind === 'newline' || argument?.value === '}' || argument?.value === ';')) ids.add('jvm');
      if (argument?.kind !== 'string') continue;
      if (token.value === 'kotlin' && ['jvm', 'multiplatform', 'android'].includes(argument.value)) ids.add('kotlin');
      if (token.value === 'id') {
        if (['java', 'java-library', 'application'].includes(argument.value)) ids.add('jvm');
        if (/^org\.jetbrains\.kotlin\.(jvm|multiplatform|android)$/.test(argument.value)) ids.add('kotlin');
        dependencies.add(argument.value.toLowerCase());
      }
    } else if (stack[0] === 'dependencies' && /^(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|annotationProcessor|compile|testCompile)$/.test(token.value) && argument?.kind === 'string') {
      if (/^[\w.-]+:[\w.-]+:[^\s$]+$/.test(argument.value)) dependencies.add(argument.value.toLowerCase().split(':').slice(0, 2).join(':'));
    }
  }
  if (stack.length !== 0) return null;
  return ids.size || dependencies.size ? { languageIds: [...ids], family: 'jvm', dependencies, packageManager: 'gradle' } : null;
}

/** Parse declaration data only. Unsupported syntax produces no strong evidence. */
export function parseManifest(name: string, text: string): ParsedManifest | null {
  name = name.toLowerCase();
  if (text.includes('\0')) return null;
  if (name === 'package.json' || name === 'composer.json' || name === 'composer.lock' || name === 'package-lock.json' || name === 'npm-shrinkwrap.json') {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return null; }
    if (!object(value)) return null;
    const php = name.startsWith('composer.');
    const dependencies = dependencyKeys(value, php ? ['require', 'require-dev'] : ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);
    if (name === 'composer.lock') for (const field of ['packages', 'packages-dev']) {
      if (Array.isArray(value[field])) for (const item of value[field]) if (object(item) && nonempty(item.name) && nonempty(item.version)) dependencies.add(item.name.toLowerCase());
    }
    if (['package-lock.json', 'npm-shrinkwrap.json'].includes(name)) {
      if (typeof value.lockfileVersion !== 'number' || !object(value.packages) || !object(value.packages[''])) return null;
      for (const dep of dependencyKeys(value.packages[''], ['dependencies', 'devDependencies', 'optionalDependencies'])) dependencies.add(dep);
    }
    const explicitJs = !php && ((nonempty(value.main) && /\.(?:c|m)?js$/.test(value.main)) || ['module', 'commonjs'].includes(String(value.type)) || (object(value.engines) && nonempty(value.engines.node)));
    if (!dependencies.size && !explicitJs) return null;
    const packageManager = php ? 'composer' : name !== 'package.json' ? 'npm' : nonempty(value.packageManager) ? /^(npm|pnpm|yarn|bun)@\d/.exec(value.packageManager)?.[1] ?? null : null;
    return { languageIds: php ? ['php'] : dependencies.has('typescript') ? ['typescript'] : ['javascript'], family: php ? 'php' : 'javascript', dependencies, packageManager };
  }
  if (/^tsconfig(?:\.base)?\.json$/.test(name)) {
    const tokens = lex(text, 'jsonc');
    if (!tokens) return null;
    const json = tokens.filter((token) => token.kind !== 'newline').map((token) => token.kind === 'string' ? JSON.stringify(token.value) : token.value).join(' ').replace(/,\s*([}\]])/g, '$1');
    try {
      const value: unknown = JSON.parse(json);
      if (object(value) && (object(value.compilerOptions) || Array.isArray(value.files) || Array.isArray(value.include) || nonempty(value.extends) || Array.isArray(value.references))) return { languageIds: ['typescript'], family: 'javascript', dependencies: new Set(), packageManager: null };
    } catch { /* unsupported configuration */ }
    return null;
  }
  if (DETECTION_ADAPTER_RULES.find((rule) => rule.id === 'python')!.manifestBasenames.includes(name)) return pythonManifest(name, text);
  if (name === 'pom.xml' || /\.(?:cs|fs|vb)proj$/.test(name) || name === 'packages.config') return xmlManifest(name, text);
  if (name === 'build.gradle' || name === 'build.gradle.kts') return gradleManifest(text);
  if (name === 'go.mod') {
    if (text.includes('/*') || text.includes('"') || text.includes('`')) return null;
    const dependencies = new Set<string>(); let module = false; let required = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (/^module\s+[A-Za-z0-9._~\/-]+$/.test(line)) module = true;
      if (/^require\s*\($/.test(line)) { required = true; continue; }
      if (line === ')') { required = false; continue; }
      const match = (required ? /^([A-Za-z0-9._~\/-]+)\s+v\S+$/ : /^require\s+([A-Za-z0-9._~\/-]+)\s+v\S+$/).exec(line);
      if (match) dependencies.add(match[1].toLowerCase());
    }
    return module && !required ? { languageIds: ['go'], family: 'go', dependencies, packageManager: 'go' } : null;
  }
  if (name === 'cargo.toml' || name === 'cargo.lock') {
    const entries = tomlEntries(text); if (!entries) return null;
    const dependencies = new Set<string>(); let valid = false;
    const dependencyTables = new Map<string, { name: string; package?: string }>();
    for (const entry of entries) {
      const section = entry.section.join('.');
      if ((section === 'package' && entry.key === 'name' && nonempty(entry.value)) || (section === 'workspace' && entry.key === 'members' && Array.isArray(entry.value))) valid = true;
      if (name === 'cargo.lock' && entry.arrayTable && section === 'package' && entry.key === 'name' && nonempty(entry.value)) dependencies.add(entry.value.toLowerCase());
      const depSection = /^(?:(?:workspace|target\..+)\.)?(?:dependencies|dev-dependencies|build-dependencies)$/;
      if (depSection.test(section) && (nonempty(entry.value) || (object(entry.value) && (entry.value.workspace === true || ['version', 'path', 'git'].some((key) => nonempty((entry.value as Record<string, unknown>)[key])))))) dependencies.add(object(entry.value) && nonempty(entry.value.package) ? entry.value.package.toLowerCase() : entry.key);
      if (entry.section.length > 1 && depSection.test(entry.section.slice(0, -1).join('.')) && ['version', 'path', 'git', 'package'].includes(entry.key) && nonempty(entry.value)) {
        const table = dependencyTables.get(section) ?? { name: entry.section.at(-1)! };
        if (entry.key === 'package') table.package = entry.value.toLowerCase();
        dependencyTables.set(section, table);
      }
    }
    for (const dependency of dependencyTables.values()) dependencies.add(dependency.package ?? dependency.name);
    return valid ? { languageIds: ['rust'], family: 'rust', dependencies, packageManager: 'cargo' } : null;
  }
  if (name === 'pubspec.yaml') {
    const dependencies = new Set<string>(); let scope = ''; let valid = false;
    for (const line of text.split(/\r?\n/)) {
      const top = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (top) {
        scope = ['dependencies', 'dev_dependencies'].includes(top[1]) && /^(?:#.*)?$/.test(top[2]) ? top[1] : '';
        if (top[1] === 'name' && /^['"]?[a-z][a-z0-9_]*['"]?(?:\s+#.*)?$/.test(top[2])) valid = true;
      } else if (scope) {
        const dependency = /^  ([a-z][a-z0-9_]*)\s*:\s*(.*)$/.exec(line);
        if (dependency && !/^[*&!|>]/.test(dependency[2])) dependencies.add(dependency[1]);
      }
    }
    return valid ? { languageIds: ['dart'], family: 'dart', dependencies, packageManager: 'pub' } : null;
  }
  if (name === 'gemfile' || name.endsWith('.gemspec')) {
    // Heredocs/percent strings are outside this static subset; do not scan their contents.
    if (/<<|%[qQwWiIrxs]?[(\[{<|]/.test(text)) return null;
    const tokens = lex(text, 'code'); if (!tokens) return null;
    const dependencies = new Set<string>();
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const startsLine = i === 0 || tokens[i - 1].kind === 'newline';
      if (token.kind === 'word' && token.value === 'gem' && startsLine) {
        const call = tokens[i + 1]?.value === '(';
        const value = tokens[i + (call ? 2 : 1)];
        const following = tokens[i + (call ? 3 : 2)];
        if (value?.kind === 'string' && /^[a-zA-Z0-9_-]+$/.test(value.value)
          && (!following || following.kind === 'newline' || [',', ')'].includes(following.value))) dependencies.add(value.value.toLowerCase());
      }
    }
    return dependencies.size ? { languageIds: ['ruby'], family: 'ruby', dependencies, packageManager: 'bundler' } : null;
  }
  if (name === 'gemfile.lock') {
    const dependencies = new Set<string>(); let scope = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^\S/.test(line)) scope = line === 'DEPENDENCIES';
      else if (scope) { const match = /^  ([\w-]+)(?:!|\s+\([^\n]*\))?\s*$/.exec(line); if (match) dependencies.add(match[1].toLowerCase()); }
    }
    return dependencies.size ? { languageIds: ['ruby'], family: 'ruby', dependencies, packageManager: 'bundler' } : null;
  }
  return null;
}

export function frameworksForManifest(manifest: ParsedManifest): FrameworkMarker[] {
  const rule = DETECTION_ADAPTER_RULES.find((candidate) => candidate.languageFamily === manifest.family);
  if (!rule) return [];
  return rule.frameworkMarkers.filter((marker) => marker.tokens.some((token) => [...manifest.dependencies].some((dependency) => {
    token = token.toLowerCase();
    if (manifest.family === 'jvm') {
      if (token === 'spring-boot') return dependency === 'org.springframework.boot' || dependency.startsWith('org.springframework.boot:');
      return dependency.startsWith(`${token}:`) || dependency.startsWith(`${token}.`);
    }
    if (manifest.family === 'dotnet') return dependency === token || dependency.startsWith(`${token}.`);
    if (manifest.family === 'go') return dependency === token || new RegExp(`^${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/v\\d+$`).test(dependency);
    return dependency === token;
  })));
}
