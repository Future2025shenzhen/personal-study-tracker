import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
const legacy = fs
  .readFileSync("tests/fixtures/math-001-accounts.sql", "utf8")
  .match(
    /create or replace function public\.pp_new_user\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/,
  )![1];
const exported = fs
  .readFileSync("tests/fixtures/math-pp-new-user-export.sql", "utf8")
  .match(/AS \$function\$([\s\S]*?)\$function\$/)![1];
// Ignore whitespace BETWEEN tokens, preserving all characters inside literals.
const tokens = (s: string) =>
  s.match(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|[\p{L}_][\p{L}\p{N}_$]*|\d+|->>|->|:=|!~|<>|\|\||[^\s]/gu,
  );
it("owner-supplied export has exactly the same validator tokens, including literal text", () => {
  expect(exported).not.toBe(legacy);
  expect(tokens(exported)).toEqual(tokens(legacy));
});
it("generated checks accept only the two reviewed fingerprints and exact function bodies", () => {
  const check = fs.readFileSync(
      "supabase/shared/00_check_math_library.sql",
      "utf8",
    ),
    install = fs.readFileSync("supabase/shared/01_install_shared.sql", "utf8");
  for (const body of [legacy, exported]) {
    expect(check).toContain(createHash("md5").update(body).digest("hex"));
    expect(install).toContain(body);
  }
  expect(install).toContain("p.prosrc in (");
  expect(install).not.toContain("regexp_replace(p.prosrc");
  expect(install).not.toContain(
    "CREATE OR REPLACE FUNCTION public.pp_new_user",
  );
});
