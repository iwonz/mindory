import fs from "node:fs";
import path from "node:path";
import { generateEnvExample, loadConfigCatalog, root } from "./config-catalog-utils.js";

const { CONFIG_CATALOG_SECTIONS, FLAT_CONFIG_CATALOG } = await loadConfigCatalog();
const output = generateEnvExample(CONFIG_CATALOG_SECTIONS, FLAT_CONFIG_CATALOG);
fs.writeFileSync(path.join(root, ".env.example"), output);
console.log(".env.example generated from config catalog.");
