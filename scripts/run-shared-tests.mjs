import { spawn } from "node:child_process";
function run(file, extra = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [file], {
      env: { ...process.env, ...extra },
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(file + " failed with exit " + code)),
    );
  });
}
await run("scripts/build-shared-sql.mjs");
await Promise.all([
  run("scripts/test-shared.mjs", { STUDY_TEST_LEGACY_VARIANT: "repository" }),
  run("scripts/test-shared.mjs", { STUDY_TEST_LEGACY_VARIANT: "export" }),
  run("scripts/test-shared.mjs", { STUDY_TEST_LEGACY_VARIANT: "crlf" }),
]);
console.log(
  "Shared compatibility suite passed against all THREE exact reviewed validator variants.",
);
