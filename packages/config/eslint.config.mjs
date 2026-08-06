import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const ignores = {
  ignores: [
    "**/dist/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/next-env.d.ts",
  ],
};

const baseRules = {
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    "@typescript-eslint/no-explicit-any": "error",
    "no-console": "error",
    eqeqeq: ["error", "smart"],
  },
};

/** Flat ESLint config for plain TypeScript packages (API, worker, node daemon, libraries). */
export const nodeConfig = tseslint.config(ignores, ...tseslint.configs.recommended, baseRules);

/** Flat ESLint config for React/Next.js packages. */
export const reactConfig = tseslint.config(
  ignores,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  baseRules,
);

export default nodeConfig;
