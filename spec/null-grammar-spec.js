const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

describe("automatic whitespace cleanup with no grammar", () => {
  let editor, directory, whitespace;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumine-null-whitespace-"));
    editor = await lumine.workspace.open(path.join(directory, "sample.txt"));
    whitespace = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule
      .whitespace;
    lumine.config.set("whitespace.removeTrailingWhitespace", true);
    lumine.config.set("whitespace.ensureSingleTrailingNewline", true);
    lumine.config.set("whitespace.ignoreWhitespaceOnCurrentLine", false);
  });
  afterEach(() => {
    editor?.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
    for (const key of [
      "removeTrailingWhitespace",
      "ensureSingleTrailingNewline",
      "ignoreWhitespaceOnCurrentLine",
    ])
      lumine.config.unset(`whitespace.${key}`);
  });

  it("saves the exact text without scanning and resumes cleanup on a grammar", async () => {
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(lumine.grammars.nullGrammar);
    editor.setText("value   ");
    spyOn(whitespace, "removeTrailingWhitespace").and.callThrough();
    spyOn(whitespace, "ensureSingleTrailingNewline").and.callThrough();
    await editor.save();
    expect(editor.getText()).toBe("value   ");
    expect(fs.readFileSync(editor.getPath(), "utf8")).toBe("value   ");
    expect(whitespace.removeTrailingWhitespace).not.toHaveBeenCalled();
    expect(whitespace.ensureSingleTrailingNewline).not.toHaveBeenCalled();
    editor.setGrammar(grammar);
    await editor.save();
    expect(editor.getText()).toBe("value\n");
  });
});
