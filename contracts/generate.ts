import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { contractSchemas } from "./src/index.ts";

const contractsDirectory = path.dirname(fileURLToPath(import.meta.url));
const generatedDirectory = path.join(contractsDirectory, "generated");
const checkOnly = process.argv.includes("--check");

await mkdir(generatedDirectory, { recursive: true });

const staleArtifacts: string[] = [];

for (const [name, schema] of Object.entries(contractSchemas)) {
  const artifact = {
    ...z.toJSONSchema(schema, { target: "draft-2020-12" }),
    $id: `https://starworks.community/contracts/${name}.schema.json`,
  };
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const outputPath = path.join(generatedDirectory, `${name}.schema.json`);

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8").catch(() => null);
    if (existing !== serialized) {
      staleArtifacts.push(path.relative(contractsDirectory, outputPath));
    }
  } else {
    await writeFile(outputPath, serialized, "utf8");
  }
}

if (staleArtifacts.length > 0) {
  throw new Error(
    `Generated contract artifacts are stale:\n${staleArtifacts.join("\n")}\nRun npm run contracts:generate.`,
  );
}

console.log(
  checkOnly
    ? "Contract artifacts are current."
    : `Generated ${Object.keys(contractSchemas).length} contract schemas.`,
);
