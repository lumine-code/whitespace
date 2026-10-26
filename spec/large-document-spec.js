describe("whitespace in large documents", () => {
  let editor, buffer, whitespace;
  const prefix = "x".repeat(1024 * 1024 + 1) + "\n";

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    whitespace = (await lumine.packages.activatePackage("whitespace")).mainModule.whitespace;
    editor = await lumine.workspace.open();
    buffer = editor.getBuffer();
    editor.displayLayer.reset({ softWrapColumn: Infinity });
    lumine.config.set("whitespace.ignoreWhitespaceOnCurrentLine", false);
    lumine.config.set("whitespace.ignoreWhitespaceOnlyLines", false);
    lumine.config.set("whitespace.keepMarkdownLineBreakWhitespace", false);
    editor.setTabLength(4);
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("whitespace");
  });

  function trapWholeReads() {
    const spies = ["getText", "getTextInRange"].map((name) =>
      spyOn(buffer, name).and.throwError(`unexpected ${name}`),
    );
    return () => spies.forEach((spy) => spy.and.callThrough());
  }

  it("strips trailing spans atomically without full strings or a match array", async () => {
    const suffix = "alpha   \r\n \t\r\nbeta\t\n";
    editor.setText(prefix + suffix);
    buffer.clearUndoStack();
    const before = buffer.getTextSnapshot();
    const restore = trapWholeReads();
    try {
      await whitespace.removeTrailingWhitespace(editor, "text.plain");
    } finally {
      restore();
    }
    expect(buffer.getTextSnapshot().slice(prefix.length)).toBe("alpha\r\n\r\nbeta\n");
    editor.undo();
    expect(buffer.getTextSnapshot().equals(before)).toBeTrue();
  });

  it("preserves ignored rows and Markdown breaks across chunk boundaries", async () => {
    const suffix = "alpha" + " ".repeat(32770) + "\n \t\ncurrent \nlast\t\n";
    editor.setText(prefix + suffix);
    editor.setCursorBufferPosition([3, 0]);
    lumine.config.set("whitespace.ignoreWhitespaceOnCurrentLine", true);
    lumine.config.set("whitespace.ignoreWhitespaceOnlyLines", true);
    lumine.config.set("whitespace.keepMarkdownLineBreakWhitespace", true);
    await whitespace.removeTrailingWhitespace(editor, "source.gfm");
    expect(buffer.getTextSnapshot().slice(prefix.length)).toBe(
      "alpha" + " ".repeat(32770) + "\n \t\ncurrent \nlast\n",
    );
  });

  it("converts leading tabs while retaining interior tabs and supports all tabs", async () => {
    const suffix = "\t".repeat(32770) + "a\tb\n \tx\n";
    editor.setText(prefix + suffix);
    buffer.clearUndoStack();
    const before = buffer.getTextSnapshot();
    await whitespace.convertTabsToSpaces(editor, false);
    expect(buffer.getTextSnapshot().slice(prefix.length)).toBe(
      " ".repeat(32770 * 4) + "a\tb\n \tx\n",
    );
    editor.undo();
    expect(buffer.getTextSnapshot().equals(before)).toBeTrue();
    await whitespace.convertTabsToSpaces(editor, true);
    expect(buffer.getTextSnapshot().slice(prefix.length)).toBe(
      " ".repeat(32770 * 4) + "a    b\n     x\n",
    );
  });

  it("preserves space-to-tab semantics across chunk boundaries", async () => {
    const suffix = " ".repeat(32771) + "\t\t  \t  X\n    a  b\n   \n";
    editor.setText(prefix + suffix);
    const expected = suffix.replace(/^[ \t]+/gm, (text) =>
      text.replace(/ {4}/g, "\t").replace(/ +\t/g, "\t"),
    );
    await whitespace.convertSpacesToTabs(editor);
    expect(buffer.getTextSnapshot().slice(prefix.length)).toBe(expected);
  });

  it("checks final-line emptiness from metadata and removes blank rows in one edit", () => {
    editor.setText(prefix + "\n\n\n");
    const restore = trapWholeReads();
    const lineRead = spyOn(buffer, "lineForRow").and.throwError("whole final line read");
    const changes = jasmine.createSpy("applied changes");
    const lease = buffer.onDidApplyChanges(changes);
    try {
      whitespace.ensureSingleTrailingNewline(editor);
    } finally {
      restore();
      lineRead.and.callThrough();
      lease.dispose();
    }
    expect(buffer.getLineCount()).toBe(2);
    expect(changes.calls.count()).toBe(1);
  });

  it("waits for large save cleanup and groups it into one undo", async () => {
    editor.setText(prefix + "word \n\n");
    buffer.clearUndoStack();
    const before = buffer.getTextSnapshot();
    await whitespace.prepareLargeSave(editor);
    expect(buffer.getTextSnapshot().slice(prefix.length)).toBe("word\n");
    editor.undo();
    expect(buffer.getTextSnapshot().equals(before)).toBeTrue();
  });

  it("cancels pending formatting on deactivation without changing text", async () => {
    editor.setText(prefix + "\tword\n");
    const before = buffer.getTextSnapshot();
    const pending = whitespace.convertTabsToSpaces(editor, true);
    await lumine.packages.deactivatePackage("whitespace");
    await expectAsync(pending).toBeRejected();
    expect(buffer.getTextSnapshot().equals(before)).toBeTrue();
  });
});
