import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
    // mobile/ is a separate Expo app with its own tsconfig and eslint.config.js;
    // it is checked by the mobile gate, not by the Next.js prototype's tooling.
    { ignores: ["mobile/**"] },
    {
        extends: [...next],
    },
]);
