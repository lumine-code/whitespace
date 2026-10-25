const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Whitespace command editor ownership", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let active, target, scratch, temporary;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("whitespace");
    lumine.config.set("whitespace.ignoreWhitespaceOnCurrentLine", false);
    lumine.config.set("whitespace.ensureSingleTrailingNewline", false);
    temporary = fs.realpathSync.native(os.tmpdir());
    scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(temporary, "whitespace-target-")));
    for (const name of ["active.txt", "target.txt"])
      fs.writeFileSync(path.join(scratch, name), "original\n");
    active = await lumine.workspace.open(path.join(scratch, "active.txt"));
    const targetPane = lumine.workspace.getActivePane().splitRight();
    target = await lumine.workspace.open(path.join(scratch, "target.txt"));
    expect(lumine.workspace.paneForItem(target)).toBe(targetPane);
    lumine.workspace.paneForItem(active).activate();
    expect(lumine.workspace.getActiveTextEditor()).toBe(active);
  });

  afterEach(async () => {
    active?.destroy();
    target?.destroy();
    if (lumine.packages.isPackageLoaded("whitespace"))
      await lumine.packages.unloadPackage("whitespace");
    lumine.project.setPaths([]);
    await lumine.fileWatchClient.settlePendingTeardown();
    if (scratch) {
      if (
        path.dirname(fs.realpathSync.native(scratch)) !== temporary ||
        !path.basename(scratch).startsWith("whitespace-target-")
      )
        throw new Error("Unsafe whitespace fixture cleanup");
      for (const name of ["active.txt", "target.txt", "untitled.txt"]) {
        const file = path.join(scratch, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      fs.rmdirSync(scratch);
    }
  });

  it("trims the editor that dispatched the command in another pane", () => {
    active.setText("active   \n");
    target.setText("target   \n");
    lumine.commands.dispatch(target.getElement(), "whitespace:remove-trailing-whitespace");
    expect(target.getText()).toBe("target\n");
    expect(active.getText()).toBe("active   \n");
  });

  it("converts tabs in the dispatching editor without changing the active editor", () => {
    active.setText("\tactive\n");
    target.setText("\ttarget\n");
    target.setTabLength(3);
    lumine.commands.dispatch(target.getElement(), "whitespace:convert-tabs-to-spaces");
    expect(target.getText()).toBe("   target\n");
    expect(active.getText()).toBe("\tactive\n");
  });

  it("saves the dispatching file while preserving its trailing spaces", async () => {
    active.setText("active   \n");
    target.setText("target   \n");
    await lumine.commands.dispatch(target.getElement(), "whitespace:save-with-trailing-whitespace");
    expect(fs.readFileSync(target.getPath(), "utf8")).toBe("target   \n");
    expect(fs.readFileSync(active.getPath(), "utf8")).toBe("original\n");
  });

  it("keeps an untitled dispatch target through its owning pane's Save As", async () => {
    const owner = lumine.workspace.paneForItem(target);
    owner.activate();
    const untitled = await lumine.workspace.open();
    try {
      untitled.setText("untitled   \n");
      active.setText("active   \n");
      lumine.workspace.paneForItem(active).activate();
      const file = path.join(scratch, "untitled.txt");
      spyOn(owner.getContainer().getWindow(), "showSaveDialog").and.resolveTo({ filePath: file });
      await lumine.commands.dispatch(
        untitled.getElement(),
        "whitespace:save-with-trailing-whitespace",
      );
      expect(untitled.getPath()).toBe(file);
      expect(fs.existsSync(file)).toBe(true);
      if (fs.existsSync(file)) expect(fs.readFileSync(file, "utf8")).toBe("untitled   \n");
      expect(fs.readFileSync(active.getPath(), "utf8")).toBe("original\n");
    } finally {
      untitled.destroy();
    }
  });

  it("does not redirect a workspace dispatch into an editor", () => {
    active.setText("active   \n");
    target.setText("target   \n");
    lumine.commands.dispatch(
      lumine.workspace.getElement(),
      "whitespace:remove-trailing-whitespace",
    );
    expect(
      lumine.commands.canDispatch(
        lumine.workspace.getElement(),
        "whitespace:remove-trailing-whitespace",
      ),
    ).toBe(false);
    expect(active.getText()).toBe("active   \n");
    expect(target.getText()).toBe("target   \n");
  });
});
