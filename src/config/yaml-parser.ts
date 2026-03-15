/**
 * yaml-parser.ts
 *
 * config/module-registry.yaml을 파싱하기 위한 최소한의 YAML 파서.
 * 완전한 YAML 스펙을 지원하지 않으며,
 * module-registry.yaml의 구조(들여쓰기 기반 중첩, 리스트, 스칼라)만 처리한다.
 *
 * 지원하는 구문:
 * - key: scalar (string, number, boolean)
 * - key:
 *     nested_key: value
 * - key:
 *   - list item
 * - 블록 주석 (#)
 * - 앵커/별칭 미지원
 * - 멀티라인 스트링 미지원
 */

// ─── Types ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YamlValue = string | number | boolean | null | Record<string, any> | any[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YamlObject = Record<string, any>;

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * YAML 문자열을 파싱해 JavaScript 객체로 반환한다.
 * 파싱 오류 시 Error를 던진다.
 */
export function parse(yaml: string): YamlObject {
  const lines = yaml.split("\n");
  const cleanedLines = preprocessLines(lines);
  const result = parseBlock(cleanedLines, 0);
  return result.value as YamlObject;
}

// ─── Preprocessing ────────────────────────────────────────────────────────────

interface CleanLine {
  lineNum: number;
  indent: number;
  raw: string;      // 들여쓰기 제거 후 내용
  isList: boolean;  // "- " 로 시작하는지
}

function preprocessLines(lines: string[]): CleanLine[] {
  const result: CleanLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 빈 줄 또는 주석 줄 제거
    const trimmed = line.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // 인라인 주석 제거
    const withoutComment = stripInlineComment(line);
    if (withoutComment.trim() === "") continue;

    const indent = getIndent(withoutComment);
    const content = withoutComment.trimStart();
    const isList = content.startsWith("- ");

    result.push({
      lineNum: i + 1,
      indent,
      raw: isList ? content.slice(2) : content,
      isList,
    });
  }

  return result;
}

function getIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === " ") count++;
    else if (ch === "\t") count += 2;
    else break;
  }
  return count;
}

function stripInlineComment(line: string): string {
  // 따옴표 밖에 있는 " #" 제거
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || line[i - 1] === " ")) {
      return line.slice(0, i);
    }
  }
  return line;
}

// ─── Block Parser ─────────────────────────────────────────────────────────────

interface ParseResult {
  value: YamlValue;
  consumed: number; // 처리한 CleanLine 수
}

function parseBlock(lines: CleanLine[], startIdx: number): ParseResult {
  if (startIdx >= lines.length) {
    return { value: {}, consumed: 0 };
  }

  const baseIndent = lines[startIdx].indent;
  const result: YamlObject = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];

    // 들여쓰기가 줄어들면 현재 블록 종료
    if (line.indent < baseIndent) break;

    // 리스트 항목이 예상치 못하게 나타나면 종료
    if (line.isList) break;

    // key: value 또는 key: (빈 값, 중첩 블록 시작) 파싱
    const colonIdx = line.raw.indexOf(": ");
    const colonEnd = line.raw.endsWith(":") ? line.raw.length - 1 : -1;

    if (colonIdx === -1 && colonEnd === -1) {
      // 스칼라 값 (키 없음) — 건너뜀
      i++;
      continue;
    }

    const key = colonIdx !== -1 ? line.raw.slice(0, colonIdx) : line.raw.slice(0, colonEnd);

    if (colonIdx !== -1) {
      // key: value (인라인 값)
      const rawValue = line.raw.slice(colonIdx + 2).trim();
      if (rawValue === "" || rawValue === "|" || rawValue === ">") {
        // 빈 값 or 멀티라인 → 다음 줄 확인
        i++;
        if (i < lines.length && lines[i].indent > baseIndent) {
          if (lines[i].isList) {
            // 리스트 블록
            const listResult = parseList(lines, i);
            result[key] = listResult.value;
            i += listResult.consumed;
          } else {
            // 중첩 객체
            const nested = parseBlock(lines, i);
            result[key] = nested.value;
            i += nested.consumed;
          }
        } else {
          result[key] = null;
        }
      } else {
        result[key] = parseScalar(rawValue);
        i++;
      }
    } else {
      // key: (끝이 콜론) → 중첩 블록
      i++;
      if (i < lines.length && lines[i].indent > baseIndent) {
        if (lines[i].isList) {
          const listResult = parseList(lines, i);
          result[key] = listResult.value;
          i += listResult.consumed;
        } else {
          const nested = parseBlock(lines, i);
          result[key] = nested.value;
          i += nested.consumed;
        }
      } else {
        result[key] = null;
      }
    }
  }

  return { value: result, consumed: i - startIdx };
}

function parseList(lines: CleanLine[], startIdx: number): ParseResult {
  const baseIndent = lines[startIdx].indent;
  const items: YamlValue[] = [];
  let i = startIdx;

  while (i < lines.length && lines[i].isList && lines[i].indent === baseIndent) {
    const line = lines[i];

    // 리스트 항목이 인라인 스칼라인지, 중첩 객체인지 판단
    const colonIdx = line.raw.indexOf(": ");
    const colonEnd = line.raw.endsWith(":") ? line.raw.length - 1 : -1;

    if (colonIdx !== -1 || colonEnd !== -1) {
      // 객체 항목: "key: value" 또는 "key:" 형태
      // 임시 라인 배열 구성 (현재 항목 + 다음 들여쓰기 블록)
      const itemLines: CleanLine[] = [{ ...line, indent: baseIndent, isList: false }];
      i++;

      // 더 들여쓰기된 라인들 수집
      while (i < lines.length && lines[i].indent > baseIndent) {
        itemLines.push(lines[i]);
        i++;
      }

      const itemResult = parseBlock(itemLines, 0);
      items.push(itemResult.value);
    } else {
      // 스칼라 항목
      items.push(parseScalar(line.raw));
      i++;
    }
  }

  return { value: items, consumed: i - startIdx };
}

function parseScalar(raw: string): string | number | boolean | null {
  const v = raw.trim();

  // null
  if (v === "null" || v === "~" || v === "") return null;

  // boolean
  if (v === "true" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "no" || v === "off") return false;

  // number
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);

  // 따옴표 제거
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }

  return v;
}
