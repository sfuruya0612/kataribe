/**
 * UI の固定文言が辞書を経由していることを検証する。
 * 対応する要求: REQ-UI-001
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { EN_MESSAGES } from '../src/shared/i18n';

const SOURCE_ROOT = fileURLToPath(new URL('../src', import.meta.url));

const SKIPPED_FILES = new Set([
  'shared/i18n.ts',
  'shared/markdown.ts',
  'shared/speakers.ts',
  'shared/title.ts',
  'main/summary.ts',
  'main/translation.ts',
]);

const ALLOWED_CONTENT = new Set(['タイトル未入力', '取り込んだ音声']);
const TRANSLATION_CALLS = new Set(['t', 'translate', 'tc', 'translateCount']);
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/u;

type Violation = {
  file: string;
  line: number;
  text: string;
};

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
      continue;
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
      continue;
    }
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function isTranslationCall(expression: ts.Expression): boolean {
  return (
    ts.isIdentifier(expression) && TRANSLATION_CALLS.has(expression.text)
  );
}

function isInsideTranslationCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current) && isTranslationCall(current.expression)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isNonDisplayLiteral(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return true;
  }
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return true;
  }
  if (ts.isCaseClause(parent) && parent.expression === node) {
    return true;
  }
  if (
    ts.isElementAccessExpression(parent) &&
    parent.argumentExpression === node
  ) {
    return true;
  }
  return false;
}

function collectStrings(node: ts.Node, values: string[]): void {
  if (ts.isStringLiteral(node) && !isNonDisplayLiteral(node)) {
    values.push(node.text);
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    values.push(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    values.push(node.head.text);
    for (const span of node.templateSpans) {
      values.push(span.literal.text);
    }
  }
  if (ts.isJsxText(node)) {
    values.push(node.text);
  }
  ts.forEachChild(node, (child) => collectStrings(child, values));
}

function violationsInFile(path: string): Violation[] {
  const relativePath = relative(SOURCE_ROOT, path).replaceAll('\\', '/');
  if (SKIPPED_FILES.has(relativePath)) {
    return [];
  }
  const text = readFileSync(path, 'utf8');
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node) ||
        ts.isJsxText(node)) &&
      !isInsideTranslationCall(node)
    ) {
      const values: string[] = [];
      collectStrings(node, values);
      for (const value of values) {
        if (
          !JAPANESE.test(value) ||
          ALLOWED_CONTENT.has(value) ||
          Object.hasOwn(EN_MESSAGES, value)
        ) {
          continue;
        }
        const position = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        violations.push({
          file: relativePath,
          line: position.line + 1,
          text: value.trim(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

describe('req_ui_001_ui_literals_use_the_dictionary', () => {
  it('finds no Japanese UI literal outside the dictionary', () => {
    const violations = sourceFiles(SOURCE_ROOT).flatMap(violationsInFile);

    expect(violations).toEqual([]);
  });
});
