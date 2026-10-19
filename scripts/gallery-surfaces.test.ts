// 面ごとの部品帳 (gallery/surfaces/<面の id>.html) を、面の台帳とページの点検に照らして確かめる
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { THEME_STYLE_TAG, checkMotion, findDisallowedUrls, hasPageCsp } from "../core/page-html.ts";
import { loadSurfaces } from "../core/treatment.ts";

// リポジトリのルート (scripts/ の 1 つ上)
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SURFACES_DIR = join(REPO_ROOT, "gallery", "surfaces");

// 部品帳が並べる 10 個の部品の日本語の見出し。並びもこのとおり
const COMPONENT_HEADINGS = ["ボタン", "入力欄", "カード", "ナビ", "タブ", "バッジ", "モーダル", "トースト", "表", "料金カード"] as const;

// <html> の開始タグ
const HTML_TAG_RE = /<html\b[^>]*>/;
// 面の style の中身
const SURFACE_STYLE_RE = /<style id="surface">([\s\S]*?)<\/style>/;

/** 面の style の中身。持たないときは null */
function surfaceStyle(html: string): string | null {
  return SURFACE_STYLE_RE.exec(html)?.[1] ?? null;
}

void test("面の台帳の全部の面に部品帳があり、殻と点検を通る", () => {
  const surfaces = loadSurfaces();
  assert.ok(surfaces.length > 0, "面の台帳が空でない");

  for (const surface of surfaces) {
    const label = surface.id;
    const file = join(SURFACES_DIR, `${surface.id}.html`);
    assert.equal(existsSync(file), true, `${label}: ${file} がある`);

    const html = readFileSync(file, "utf8");
    const motion = checkMotion(html);
    assert.equal(hasPageCsp(html), true, `${label}: CSP の meta が殻の位置にある`);
    assert.deepEqual(findDisallowedUrls(html), [], `${label}: 許可していない読み込みがない`);
    assert.ok(html.includes(THEME_STYLE_TAG), `${label}: テーマの style がある`);
    assert.equal(motion.ok, true, `${label}: 動きの点検を通る`);
    assert.equal(motion.hasMotion, false, `${label}: 動き なし の条件を満たす`);

    const htmlTag = HTML_TAG_RE.exec(html)?.[0] ?? "";
    assert.ok(htmlTag.includes('data-theme="minimal"'), `${label}: data-theme="minimal"`);
    assert.ok(htmlTag.includes('data-mode="light"'), `${label}: data-mode="light"`);

    const css = surfaceStyle(html);
    if (surface.css === "") {
      assert.equal(css, null, `${label}: 面の css が空なので <style id="surface"> を持たない`);
    } else {
      assert.notEqual(css, null, `${label}: <style id="surface"> がある`);
      assert.ok(css?.includes(surface.css), `${label}: 面の台帳の css をそのまま含む`);
    }

    for (const heading of COMPONENT_HEADINGS) {
      assert.ok(html.includes(heading), `${label}: 部品帳の見出し「${heading}」がある`);
    }
  }
});
