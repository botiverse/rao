const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { listPackage } = require("@electron/asar");

// Runs before signing. Verify the final archive, not merely the staging folder.
module.exports = async function verifyPackage(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const entries = new Set(listPackage(join(resources, "app.asar")));
  const expected = JSON.parse(
    readFileSync(join(__dirname, "../dist/package-dependencies.json"), "utf8"),
  );
  const missing = expected.filter(
    (path) => !entries.has(`/${path.replaceAll("\\", "/")}/package.json`),
  );
  assert.deepEqual(missing, [], `Packaged dependencies missing: ${missing.join(", ")}`);
  process.stdout.write(`Verified ${expected.length} dependency locations in final app.asar\n`);
};
