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
const crlf = JSON.parse(
  fs.readFileSync("tests/fixtures/math-pp-new-user-crlf.json", "utf8"),
).validator.source as string;
// Ignore whitespace BETWEEN tokens, preserving all characters inside literals.
const tokens = (s: string) =>
  s.match(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|[\p{L}_][\p{L}\p{N}_$]*|\d+|->>|->|:=|!~|<>|\|\||[^\s]/gu,
  );
it("owner-supplied export has exactly the same validator tokens, including literal text", () => {
  expect(exported).not.toBe(legacy);
  expect(tokens(exported)).toEqual(tokens(legacy));
  expect(crlf).not.toBe(exported);
  expect(crlf.replaceAll("\r\n", "\n")).toBe(exported);
  expect(tokens(crlf)).toEqual(tokens(legacy));
});
it("generated checks accept only the three reviewed fingerprints and escaped exact function bodies", () => {
  const check = fs.readFileSync(
      "supabase/shared/00_check_math_library.sql",
      "utf8",
    ),
    install = fs.readFileSync("supabase/shared/01_install_shared.sql", "utf8");
  for (const body of [legacy, exported, crlf]) {
    expect(check).toContain(createHash("md5").update(body).digest("hex"));
    const encoded =
      "E'" +
      body
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "''")
        .replaceAll("\r", "\\r")
        .replaceAll("\n", "\\n") +
      "'";
    expect(install).toContain(encoded);
  }
  expect(install).toContain("p.prosrc in (");
  expect(install).not.toContain("regexp_replace(p.prosrc");
  expect(install).not.toContain(
    "CREATE OR REPLACE FUNCTION public.pp_new_user",
  );
});

it("installer enforces all verification flags before COMMIT and returns them afterwards", () => {
  const text = fs.readFileSync("supabase/shared/01_install_shared.sql", "utf8");
  expect(text.indexOf("do $study_verify_before_commit$")).toBeLessThan(
    text.lastIndexOf("commit;"),
  );
  expect(text.slice(text.lastIndexOf("commit;"))).toContain(
    "as study_tables_present",
  );
});
