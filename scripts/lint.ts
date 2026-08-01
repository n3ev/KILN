import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const errors: string[] = [];
const sourceRoots = [join(root, "apps"), join(root, "packages")];

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".next", ".turbo", "coverage"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path)) && !path.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

function display(path: string): string {
  return relative(root, path).split(sep).join("/");
}

function location(source: ts.SourceFile, node: ts.Node): string {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${display(source.fileName)}:${point.line + 1}:${point.character + 1}`;
}

function inspectFile(path: string): void {
  const text = readFileSync(path, "utf8");
  const relativePath = display(path);
  const lines = text.trimEnd().split(/\r?\n/).length;
  if (lines > 400) errors.push(`${relativePath}: ${lines} lines; split hand-authored modules at 400`);

  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node: ts.Node): void {
    if (relativePath.startsWith("packages/") && node.kind === ts.SyntaxKind.AnyKeyword) {
      errors.push(`${location(source, node)}: explicit any is forbidden in packages/`);
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleName = node.moduleSpecifier.text;
      if (relativePath.startsWith("apps/web/") && moduleName.startsWith("@kiln/vault")) {
        errors.push(`${location(source, node)}: the web process must not import the credential vault`);
      }
    }

    if (
      relativePath.startsWith("packages/tools/") &&
      relativePath !== "packages/tools/core/egress.ts" &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      errors.push(`${location(source, node)}: tools must use the egress-controlled ToolContext HTTP client`);
    }

    if (
      !relativePath.startsWith("packages/model-gateway/") &&
      ts.isStringLiteralLike(node) &&
      /^(?:deepseek-(?:chat|reasoner)|moonshot-v\d|kimi-k\d|gpt-\d|claude-\d)/i.test(node.text)
    ) {
      errors.push(`${location(source, node)}: concrete model ids belong only in packages/model-gateway`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  if (
    !relativePath.startsWith("packages/vault/") &&
    /select[\s\S]{0,400}(?:credentials\s*\.\s*ciphertext|\bciphertext\b)[\s\S]{0,400}from\s+credentials/i.test(text)
  ) {
    errors.push(`${relativePath}: credential ciphertext may only be selected inside packages/vault`);
  }
  if (/plan\s*\.\s*name\s*={2,3}\s*["'](?:founder|operator|studio)["']/i.test(text)) {
    errors.push(`${relativePath}: enforce capabilities through billing can(), never a marketing plan name`);
  }
}

for (const directory of sourceRoots) {
  for (const file of sourceFiles(directory)) inspectFile(file);
}

const webPackage = JSON.parse(readFileSync(join(root, "apps", "web", "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
if (webPackage.dependencies?.["@kiln/vault"]) {
  errors.push("apps/web/package.json: the web process must not depend on @kiln/vault");
}

if (errors.length > 0) {
  console.error(`KILN structural lint failed (${errors.length})\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("KILN structural lint passed: no explicit any, vault leak, direct tool fetch, hardcoded model, or oversized module.");
}

