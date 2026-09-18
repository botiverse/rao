import { join, resolve } from "node:path";

/** Explicit test/user overrides win; development and installed builds share the default. */
export function dataDirectory(
  appData: string,
  override = process.env["RAO_USER_DATA"],
  argv = process.argv,
): string {
  const splitFlag = argv.indexOf("--user-data-dir");
  const flag =
    (splitFlag >= 0 ? argv[splitFlag + 1] : undefined) ??
    argv.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  return override || flag ? resolve(override || flag || "") : join(appData, "Rao");
}
