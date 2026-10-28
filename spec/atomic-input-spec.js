describe("Whitespace during atomic input", () => {
  let editor, execution;
  beforeEach(async () => {
    jasmine.useRealClock();
    execution = lumine.grammars.syntaxExecution;
    lumine.grammars.syntaxExecution = "worker";
    await lumine.packages.activatePackage("language-python");
    await lumine.packages.activatePackage("whitespace");
    lumine.config.set("whitespace.removeTrailingWhitespace", true);
    lumine.config.set("whitespace.ignoreWhitespaceOnlyLines", false);
    editor = await lumine.workspace.open();
    editor.update({ autoIndent: true, tabLength: 4, softTabs: true });
  });
  afterEach(() => {
    editor?.destroy();
    lumine.grammars.syntaxExecution = execution;
  });
  for (const ending of ["\n", "\r\n"])
    it(`cleans abandoned indentation within each ${JSON.stringify(ending)} insertion`, async () => {
      const original = "class Record:" + ending + "    ";
      editor.setText(original);
      lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python");
      await editor.whenGrammarSettled();
      editor.setCursorBufferPosition([1, 4]);
      editor.getBuffer().clearUndoStack();
      const changes = [];
      editor.getBuffer().onDidApplyChanges(() => changes.push(editor.getText()));
      const scan = spyOn(
        editor.getBuffer().getLanguageMode(),
        "scanPreparedIndentation",
      ).and.callThrough();
      for (let i = 0; i < 8; i++) await editor.insertNewline();
      expect(changes.length).toBe(8);
      expect(changes.every((text) => text.endsWith(ending + "    "))).toBe(true);
      expect(editor.getText()).toBe("class Record:" + ending.repeat(9) + "    ");
      expect(scan).not.toHaveBeenCalled();
      for (let i = 0; i < 8; i++) editor.undo();
      expect(editor.getText()).toBe(original);
    });
  it("does not materialize a source-backed insertion to check whether it is a newline", async () => {
    editor.setText("class Record:");
    lumine.grammars.assignLanguageMode(editor.getBuffer(), "source.python");
    await editor.whenGrammarSettled();
    const source = {
      length: 1000000000,
      slice() {
        throw new Error("Should not read source");
      },
    };
    expect(() =>
      editor.emitWillPublishTextInsertion({
        range: editor.getSelectedBufferRange(),
        textSource: source,
        get text() {
          throw new Error("Should not materialize source");
        },
      }),
    ).not.toThrow();
  });
});
