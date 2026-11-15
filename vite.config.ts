import { defineConfig } from "vite-plus";

const ignored = [
  "apps/**",
  "experiments/**",
  "docs/**",
  "PRIOR_ART.md",
  "research/**",
  ".starworks/**",
  "**/node_modules/**",
  "**/build/**",
  "**/.react-router/**",
  "**/.tickets/**",
  "**/drizzle/**",
];

export default defineConfig({
  fmt: {
    ignorePatterns: ignored,
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    printWidth: 80,
    trailingComma: "all",
    sortImports: false,
    sortPackageJson: false,
  },
  lint: {
    ignorePatterns: ignored,
  },
});
