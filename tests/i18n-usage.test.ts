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

// これらは画面ではなく、保存データ、Markdown、LLM プロンプトの文言を持つ。
// UI の固定文言はコンポーネントと main のメッセージ層で検査する。
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

// 選択肢の label は MessageKey として t に渡す設定値だけを許可する。
// JSX のテキストや属性値に辞書キーを直書きした場合は検出する。
function isDictionaryKeyUsedAsLabel(node: ts.Node, value: string): boolean {
  if (!Object.hasOwn(EN_MESSAGES, value)) {
    return false;
  }
  const parent = node.parent;
  return (
    ts.isPropertyAssignment(parent) && parent.name.getText() === 'label'
  );
}

function literalValues(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ];
  }
  if (ts.isJsxText(node)) {
    return [node.text];
  }
  return [];
}

/**
 * 翻訳呼び出しの中に別の翻訳呼び出しがあると、内側の訳文が外側の文へ
 * 埋め込まれて日本語と英語の両方が壊れるため、入れ子を検出する。
 */
function nestedTranslationCall(
  outer: ts.CallExpression,
): ts.CallExpression | null {
  let found: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) {
      return;
    }
    if (
      node !== outer &&
      ts.isCallExpression(node) &&
      isTranslationCall(node.expression)
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  for (const argument of outer.arguments) {
    visit(argument);
  }
  return found;
}

function violationsInSource(
  relativePath: string,
  text: string,
): Violation[] {
  const sourceFile = ts.createSourceFile(
    relativePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTranslationCall(node.expression)) {
      const nested = nestedTranslationCall(node);
      if (nested !== null) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          nested.getStart(sourceFile),
        );
        violations.push({
          file: relativePath,
          line: position.line + 1,
          text: 'nested translation call',
        });
      }
    }

    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node) ||
        ts.isJsxText(node)) &&
      !(ts.isStringLiteral(node) && isNonDisplayLiteral(node)) &&
      !isInsideTranslationCall(node)
    ) {
      const values = literalValues(node);
      for (const value of values) {
        if (
          !JAPANESE.test(value) ||
          ALLOWED_CONTENT.has(value) ||
          isDictionaryKeyUsedAsLabel(node, value)
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

function violationsInFile(path: string): Violation[] {
  const relativePath = relative(SOURCE_ROOT, path).replaceAll('\\', '/');
  if (SKIPPED_FILES.has(relativePath)) {
    return [];
  }
  return violationsInSource(relativePath, readFileSync(path, 'utf8'));
}

describe('req_ui_001_ui_literals_use_the_dictionary', () => {
  it('finds no Japanese UI literal outside the dictionary', () => {
    const violations = sourceFiles(SOURCE_ROOT).flatMap(violationsInFile);

    expect(violations).toEqual([]);
  });

  it('reports a nested translation call and a Japanese template tail', () => {
    const source = [
      "const nested = t('outer', { value: t('inner') });",
      'const tail = `prefix ${value} 日本語`;',
      'const jsx = <span>日本語</span>;',
    ].join('\n');

    const violations = violationsInSource('renderer/src/bad.tsx', source);

    expect(violations.map((violation) => violation.text).sort()).toEqual(
      ['nested translation call', '日本語', '日本語'].sort(),
    );
  });

  it('accepts translation calls, label keys, and non-Japanese templates', () => {
    const source = [
      "const a = t('日本語');",
      "const b = { label: '一般' };",
      'const c = `prefix ${value} suffix`;',
      "const d = tc(1, '1 件', '{count} 件');",
    ].join('\n');

    expect(violationsInSource('renderer/src/good.tsx', source)).toEqual([]);
  });
});
