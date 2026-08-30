import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

const engineModules = new Set([
  "accounting", "dependencies", "diagnostics", "funding", "identity", "lineage",
  "model", "primitives", "rules", "semantics", "simulation", "state", "statements",
  "time", "valuation", "values",
]);
const lowerModules = new Set([...engineModules].filter((name) => name !== "simulation"));
const facadeFiles = new Set([
  "src/accounting.ts", "src/diagnostics.ts", "src/funding.ts", "src/identity.ts",
  "src/kernel.ts", "src/lineage.ts", "src/modelVersion.ts", "src/provenance.ts",
  "src/run.ts", "src/semantics.ts", "src/state.ts", "src/time.ts", "src/values.ts",
  "src/version.ts", "src/verticalSlice1.ts",
]);
const unambiguousBrowserGlobals = new Set([
  "window", "HTMLElement", "HTMLInputElement", "localStorage", "navigator",
]);
const documentMembers = new Set([
  "body", "createElement", "getElementById", "querySelector", "querySelectorAll",
]);

const normalized = (value) => value.split(path.sep).join("/");

const moduleName = (file) => {
  const match = /^src\/([^/]+)\//.exec(file);
  return match && engineModules.has(match[1]) ? match[1] : undefined;
};

const isRuntimeImport = (node) => {
  if (ts.isImportDeclaration(node)) {
    if (!node.importClause) return true;
    if (node.importClause.isTypeOnly) return false;
    if (node.importClause.name || node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) return true;
    return node.importClause.namedBindings?.elements.some((element) => !element.isTypeOnly) ?? false;
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return false;
    if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
    return node.exportClause.elements.some((element) => !element.isTypeOnly);
  }
  return false;
};

const resolveImport = (fromFile, specifier, files) => {
  if (!specifier.startsWith(".")) return undefined;
  const raw = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const stem = raw.replace(/\.js$/, "");
  for (const candidate of [`${stem}.ts`, `${stem}/index.ts`]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
};

const importDeclarations = (sourceFile) => sourceFile.statements.filter((node) =>
  (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier));

const cycleErrors = (graph) => {
  const errors = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const reported = new Set();
  const visit = (file) => {
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      const cycle = [...stack.slice(start), file];
      const key = [...new Set(cycle.slice(0, -1))].sort().join("|");
      if (!reported.has(key)) {
        reported.add(key);
        errors.push(`runtime import cycle: ${cycle.join(" -> ")}`);
      }
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of [...graph.keys()].sort()) visit(file);
  return errors;
};

export function validateSources(sourceFiles) {
  const files = new Map([...sourceFiles].map(([name, source]) => [normalized(name), source]));
  const errors = [];
  const graph = new Map([...files.keys()].map((file) => [file, new Set()]));

  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const owner = moduleName(file);

    if (facadeFiles.has(file)) {
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)
          && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
          errors.push(`compatibility facade contains implementation: ${file}`);
          break;
        }
      }
    }

    for (const declaration of importDeclarations(sourceFile)) {
      if (!isRuntimeImport(declaration)) continue;
      const specifier = declaration.moduleSpecifier.text;
      const target = resolveImport(file, specifier, files);
      if (target) graph.get(file).add(target);
      if (owner && (target === "src/webApp.ts" || target?.includes("/web/"))) {
        errors.push(`engine-to-UI import: ${file} -> ${target}`);
      }
      if (owner && lowerModules.has(owner) && target?.startsWith("src/simulation/")) {
        errors.push(`lower-module-to-simulation import: ${file} -> ${target}`);
      }
    }

    if (owner) {
      const visit = (node) => {
        if (ts.isIdentifier(node)) {
          const parent = node.parent;
          const browserUse = unambiguousBrowserGlobals.has(node.text)
            || node.text === "fetch" && ts.isCallExpression(parent) && parent.expression === node
            || node.text === "location" && ts.isPropertyAccessExpression(parent) && parent.expression === node
            || node.text === "document" && ts.isPropertyAccessExpression(parent) && parent.expression === node && documentMembers.has(parent.name.text);
          if (browserUse) errors.push(`browser global ${node.text} used in engine module: ${file}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }

  errors.push(...cycleErrors(graph));
  return [...new Set(errors)].sort();
}

async function readTypeScriptFiles(root) {
  const files = new Map();
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.set(normalized(path.relative(root, absolute)), await readFile(absolute, "utf8"));
      }
    }
  };
  await walk(path.join(root, "src"));
  return files;
}

function runSelfTests() {
  const cases = [
    {
      name: "engine-to-UI",
      files: new Map([["src/values/bad.ts", 'import "../webApp.js";'], ["src/webApp.ts", "export {};" ]]),
      expected: "engine-to-UI import",
    },
    {
      name: "lower-to-simulation",
      files: new Map([["src/state/bad.ts", 'import "../simulation/run.js";'], ["src/simulation/run.ts", "export {};" ]]),
      expected: "lower-module-to-simulation import",
    },
    {
      name: "runtime-cycle",
      files: new Map([["src/values/a.ts", 'import "./b.js";'], ["src/values/b.ts", 'import "./a.js";']]),
      expected: "runtime import cycle",
    },
  ];
  for (const testCase of cases) {
    const errors = validateSources(testCase.files);
    if (!errors.some((error) => error.includes(testCase.expected))) {
      throw new Error(`Architecture validator self-test failed: ${testCase.name}`);
    }
  }
}

export async function validateRepository(root = defaultRoot) {
  return validateSources(await readTypeScriptFiles(root));
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  runSelfTests();
  const errors = await validateRepository();
  if (errors.length > 0) {
    console.error(`Architecture validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Architecture validation passed: engine/UI direction, lower-layer isolation, facade shape, browser isolation, and runtime acyclicity are enforced (type-only imports are excluded from runtime cycles). Self-tests passed.");
  }
}
