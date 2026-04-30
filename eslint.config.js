import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import eslintReact from "@eslint-react/eslint-plugin";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      eslintPluginUnicorn.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
      eslintReact.configs["strict-type-checked"],
      eslintReact.configs["disable-conflict-eslint-plugin-react-hooks"],
    ],
    rules: {
      "@typescript-eslint/array-type": ["error", { default: "generic" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "@eslint-react/use-state": [
        "error",
        { enforceLazyInitialization: false },
      ],
      "unicorn/no-null": "off",
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
        },
      ],
      curly: ["error", "all"],
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: {
            db: true,
            env: true,
            Env: true,
            props: true,
            Props: true,
            ref: true,
            Ref: true,
            dev: true,
            Dev: true,
            docs: true,
            // Common in URL/route/function signatures
            params: true,
            Params: true,
            // IFC domain terminology (IfcRelDefinesByProperties, IfcRelAggregates, etc.)
            rel: true,
            Rel: true,
            // 3D graphics: direction vectors (three.js convention)
            dir: true,
            Dir: true,
            // proj4 definition strings
            def: true,
            Def: true,
          },
        },
      ],
    },
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/worker/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.worker,
    },
  },
]);
