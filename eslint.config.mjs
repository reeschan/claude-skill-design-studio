import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  // 型情報を使うルール。any の受け渡しや、待たれずに捨てられる Promise を検出する
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  // 循環的複雑度の上限。超えたら関数を分ける
  { rules: { complexity: ["error", { max: 10 }] } },
  // 書式は Prettier に任せる。最後に置いて書式ルールを無効化する
  prettier,
  // docs/pbi/ は PBI の作業用ファイルと手本の写し。gallery/ は見本の生成物
  globalIgnores(["node_modules/**", "coverage/**", "docs/pbi/**", "gallery/**"]),
]);
