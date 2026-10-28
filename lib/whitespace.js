const { CompositeDisposable } = require("lumine");

const TRAILING_WHITESPACE_REGEX = /[ \t]+(?=\r?$)/g;
const LARGE_TEXT_UNITS = 1024 * 1024;
const commandEditor = (event) =>
  lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false });

// The usual row finishes synchronously. Very long whitespace-only rows yield
// between bounded reads instead of blocking the renderer inside a predicate.
function trailingStartFor(source, start, end, signal) {
  let position = end;
  const scan = () => {
    const deadline = performance.now() + 4;
    while (position > start) {
      signal.throwIfAborted();
      const chunkStart = Math.max(start, position - 16384);
      const chunk = source.slice(chunkStart, position);
      const length = chunk.match(/[ \t]*$/)[0].length;
      position -= length;
      if (length !== chunk.length) return position;
      if (performance.now() >= deadline)
        return new Promise((resolve) => setTimeout(resolve, 0)).then(scan);
    }
    return position;
  };
  return scan();
}

module.exports = class Whitespace {
  constructor() {
    this.watchedEditors = new WeakSet();
    this.preservingSaves = new WeakMap();
    this.pendingChanges = new Set();
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(
      lumine.workspace.observeTextEditors((editor) => {
        return this.handleEvents(editor);
      }),
    );

    this.subscriptions.add(
      lumine.commands.add("lumine-text-editor:not([mini]):not([readonly])", {
        "whitespace:remove-trailing-whitespace": {
          description: "Strip the trailing spaces from every line in the file.",
          didDispatch: (event) => {
            let editor = commandEditor(event);
            if (editor) {
              return this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName);
            }
          },
        },

        "whitespace:save-with-trailing-whitespace": {
          description: "Save this once without stripping the trailing spaces.",
          didDispatch: (event) => {
            const editor = commandEditor(event);
            if (editor) return this.saveWithTrailingWhitespace(editor);
          },
        },

        "whitespace:save-without-trailing-whitespace": {
          description: "Strip the trailing spaces and save, whatever the setting says.",
          didDispatch: async (event) => {
            let editor = commandEditor(event);

            if (editor) {
              await this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName);
              return await this.saveEditor(editor);
            }
          },
        },

        "whitespace:convert-tabs-to-spaces": {
          description: "Turn the tabs that indent each line into spaces.",
          didDispatch: (event) => {
            let editor = commandEditor(event);

            if (editor) {
              return this.convertTabsToSpaces(editor);
            }
          },
        },

        "whitespace:convert-spaces-to-tabs": {
          description: "Turn the spaces that indent each line into tabs.",
          didDispatch: (event) => {
            let editor = commandEditor(event);

            if (editor) {
              return this.convertSpacesToTabs(editor);
            }
          },
        },

        "whitespace:convert-all-tabs-to-spaces": {
          description: "Turn every tab into spaces, not only the indentation.",
          didDispatch: (event) => {
            let editor = commandEditor(event);

            if (editor) {
              return this.convertTabsToSpaces(editor, true);
            }
          },
        },
      }),
    );
  }

  destroy() {
    for (const controller of this.pendingChanges) controller.abort();
    this.pendingChanges.clear();
    return this.subscriptions.dispose();
  }

  saveEditor(editor) {
    if (editor.getPath()) return editor.save();
    const pane =
      lumine.workspace.paneForItem(editor) ?? lumine.workspace.getCenter().getActivePane();
    return pane.getActiveItem() === editor ? pane.saveActiveItemAs() : pane.saveItemAs(editor);
  }

  async saveWithTrailingWhitespace(editor) {
    const buffer = editor.getBuffer();
    this.preservingSaves.set(buffer, (this.preservingSaves.get(buffer) || 0) + 1);
    try {
      return await this.saveEditor(editor);
    } finally {
      const pending = this.preservingSaves.get(buffer) - 1;
      if (pending) this.preservingSaves.set(buffer, pending);
      else this.preservingSaves.delete(buffer);
    }
  }

  handleEvents(editor) {
    if (this.watchedEditors.has(editor)) return;

    let buffer = editor.getBuffer();

    let bufferSavedSubscription = buffer.onWillSave(() => {
      if (editor.getGrammar() === lumine.grammars.nullGrammar) return;
      if (buffer.getLength() > LARGE_TEXT_UNITS) return this.prepareLargeSave(editor);
      return buffer.transact(() => {
        let scopeDescriptor = editor.getRootScopeDescriptor();

        if (
          lumine.config.get("whitespace.removeTrailingWhitespace", {
            scope: scopeDescriptor,
          }) &&
          !this.preservingSaves.has(buffer)
        ) {
          this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName);
        }

        if (
          lumine.config.get("whitespace.ensureSingleTrailingNewline", { scope: scopeDescriptor })
        ) {
          return this.ensureSingleTrailingNewline(editor);
        }
      });
    });

    let editorTextInsertedSubscription = editor.onWillPublishTextInsertion(function (event) {
      if (editor.getGrammar() === lumine.grammars.nullGrammar) return;
      const source = event.textSource;
      if (source && source.length > 2) return;
      const text = source ? source.slice(0, source.length) : event.text;
      if (text !== "\n" && text !== "\r\n") {
        return;
      }
      const target = event.editor;
      if (!target.getBuffer().isRowBlank(event.range.start.row)) {
        return;
      }

      let scopeDescriptor = editor.getRootScopeDescriptor();

      if (
        lumine.config.get("whitespace.removeTrailingWhitespace", {
          scope: scopeDescriptor,
        })
      ) {
        if (
          !lumine.config.get("whitespace.ignoreWhitespaceOnlyLines", {
            scope: scopeDescriptor,
          })
        ) {
          return target.setIndentationForBufferRow(event.range.start.row, 0);
        }
      }
    });

    let editorDestroyedSubscription = editor.onDidDestroy(() => {
      bufferSavedSubscription.dispose();
      editorTextInsertedSubscription.dispose();
      editorDestroyedSubscription.dispose();
      this.subscriptions.remove(bufferSavedSubscription);
      this.subscriptions.remove(editorTextInsertedSubscription);
      this.subscriptions.remove(editorDestroyedSubscription);
      this.watchedEditors.delete(editor);
    });

    this.subscriptions.add(bufferSavedSubscription);
    this.subscriptions.add(editorTextInsertedSubscription);
    this.subscriptions.add(editorDestroyedSubscription);
    this.watchedEditors.add(editor);
  }

  removeTrailingWhitespace(editor, grammarScopeName) {
    const buffer = editor.getBuffer();
    const scopeDescriptor = editor.getRootScopeDescriptor();

    // When buffer is same buffer of activeEditor's buffer, don't remove
    // trailing WS at activeEditor's cursor line.
    const activeEditor = lumine.workspace.getActiveTextEditor();
    const cursorRows =
      activeEditor && activeEditor.getBuffer() === buffer
        ? new Set(activeEditor.getCursors().map((cursor) => cursor.getBufferRow()))
        : new Set();

    const ignoreCurrentLine = lumine.config.get("whitespace.ignoreWhitespaceOnCurrentLine", {
      scope: scopeDescriptor,
    });

    const ignoreWhitespaceOnlyLines = lumine.config.get("whitespace.ignoreWhitespaceOnlyLines", {
      scope: scopeDescriptor,
    });

    const keepMarkdownLineBreakWhitespace =
      (grammarScopeName === "source.gfm" || grammarScopeName === "text.md") &&
      lumine.config.get("whitespace.keepMarkdownLineBreakWhitespace");

    if (buffer.getLength() > LARGE_TEXT_UNITS) {
      const source = buffer.getTextSnapshot();
      let lastRow = -1,
        trailingStart = 0,
        lineStart = 0,
        lineEnd = 0;
      return this.replaceLarge(buffer, /[ \t]{1,32768}/g, "", {
        shouldReplace: ({ start }, signal) => {
          const { row } = source.positionAt(start);
          const eligible = () =>
            start >= trailingStart &&
            !(ignoreCurrentLine && cursorRows.has(row)) &&
            !(ignoreWhitespaceOnlyLines && trailingStart === lineStart) &&
            !(
              keepMarkdownLineBreakWhitespace &&
              trailingStart > lineStart &&
              lineEnd - trailingStart >= 2
            );
          if (row !== lastRow) {
            lastRow = row;
            lineStart = source.lineStart(row);
            lineEnd = row + 1 < source.lineCount ? source.lineStart(row + 1) - 1 : source.length;
            if (source.charCodeAt(lineEnd - 1) === 13) lineEnd--;
            const result = trailingStartFor(source, lineStart, lineEnd, signal);
            if (result?.then)
              return result.then((position) => {
                trailingStart = position;
                return eligible();
              });
            trailingStart = result;
          }
          return eligible();
        },
      });
    }

    const edits = [];
    const ranges = buffer.findAllSync(TRAILING_WHITESPACE_REGEX);
    for (let i = 0, n = ranges.length; i < n; i++) {
      const range = ranges[i];
      const row = range.start.row;
      const trailingWhitespaceStart = ranges[i].start.column;
      if (ignoreCurrentLine && cursorRows.has(row)) continue;
      if (ignoreWhitespaceOnlyLines && trailingWhitespaceStart === 0) continue;
      if (keepMarkdownLineBreakWhitespace) {
        const whitespaceLength = range.end.column - range.start.column;
        if (trailingWhitespaceStart > 0 && whitespaceLength >= 2) continue;
      }
      edits.push({ range, text: "" });
    }
    buffer.setTextInIndependentRanges(edits);
  }

  ensureSingleTrailingNewline(editor) {
    let selectedBufferRanges;
    let row;
    let buffer = editor.getBuffer();
    let lastRow = buffer.getLastRow();

    if (buffer.lineLengthForRow(lastRow) === 0) {
      row = lastRow - 1;

      while (row > 0 && buffer.lineLengthForRow(row) === 0) row--;
      if (row + 1 < lastRow) buffer.deleteRows(row + 1, lastRow - 1);
    } else {
      selectedBufferRanges = editor.getSelectedBufferRanges();
      buffer.append("\n");
      editor.setSelectedBufferRanges(selectedBufferRanges);
    }
  }

  convertTabsToSpaces(editor, convertAllTabs) {
    let buffer = editor.getBuffer();
    let spacesText = new Array(editor.getTabLength() + 1).join(" ");
    let regex = convertAllTabs ? /\t/g : /^\t+/g;

    if (buffer.getLength() > LARGE_TEXT_UNITS) {
      const source = buffer.getTextSnapshot();
      let row = -1,
        leadingEnd = 0;
      return this.replaceLarge(buffer, /\t{1,32768}/g, "", {
        shouldReplace: ({ start, end }) => {
          if (convertAllTabs) return true;
          const position = source.positionAt(start);
          if (position.row !== row) {
            row = position.row;
            leadingEnd = source.lineStart(row);
          }
          if (start !== leadingEnd) return false;
          leadingEnd = end;
          return true;
        },
        transformReplacement: (_replacement, match) => spacesText.repeat(match.length),
      }).then(() => editor.setSoftTabs(true));
    }

    buffer.setTextInIndependentRanges(
      lineEditsForMatches(buffer, regex, (text) => text.replace(/\t/g, spacesText)),
    );

    return editor.setSoftTabs(true);
  }

  convertSpacesToTabs(editor) {
    let buffer = editor.getBuffer();
    let scope = editor.getRootScopeDescriptor();
    let fileTabSize = editor.getTabLength();

    let userTabSize = lumine.config.get("editor.tabLength", {
      scope: scope,
    });

    let regex = new RegExp(" ".repeat(fileTabSize), "g");

    if (buffer.getLength() > LARGE_TEXT_UNITS) {
      const source = buffer.getTextSnapshot();
      let row = -1,
        leadingEnd = 0,
        remainder = 0,
        matchEnd = 0;
      return this.replaceLarge(buffer, / {1,32768}|\t{1,32768}/g, "", {
        shouldReplace: ({ start, end }) => {
          const position = source.positionAt(start);
          if (position.row !== row) {
            row = position.row;
            leadingEnd = source.lineStart(row);
            remainder = 0;
          }
          if (start !== leadingEnd) return false;
          leadingEnd = matchEnd = end;
          return true;
        },
        transformReplacement: (_replacement, match) => {
          if (match[0] === "\t") return match;
          const count = remainder + match.length;
          const tabs = "\t".repeat(Math.floor(count / fileTabSize));
          remainder = count % fileTabSize;
          if (source.charCodeAt(matchEnd) === 32) return tabs;
          const suffix = source.charCodeAt(matchEnd) === 9 ? "" : " ".repeat(remainder);
          remainder = 0;
          return tabs + suffix;
        },
      }).then(() => {
        editor.setSoftTabs(false);
        if (fileTabSize !== userTabSize) editor.setTabLength(userTabSize);
      });
    }

    buffer.setTextInIndependentRanges(
      lineEditsForMatches(buffer, /^[ \t]+/g, (text) =>
        text.replace(regex, "\t").replace(/[ ]+\t/g, "\t"),
      ),
    );

    editor.setSoftTabs(false);

    if (fileTabSize !== userTabSize) {
      return editor.setTabLength(userTabSize);
    }
  }

  replaceLarge(buffer, regex, replacement, options) {
    const controller = new AbortController();
    this.pendingChanges.add(controller);
    const lease = buffer.onDidDestroy(() => controller.abort());
    return buffer
      .replaceAllMatches(regex, replacement, {
        ...options,
        shouldReplace:
          options.shouldReplace && ((found) => options.shouldReplace(found, controller.signal)),
        signal: controller.signal,
        literalReplacement: true,
      })
      .finally(() => {
        lease.dispose();
        this.pendingChanges.delete(controller);
      });
  }

  async prepareLargeSave(editor) {
    const buffer = editor.getBuffer();
    const scope = editor.getRootScopeDescriptor();
    const before = buffer.getTextRevision();
    if (
      lumine.config.get("whitespace.removeTrailingWhitespace", { scope }) &&
      !this.preservingSaves.has(buffer)
    )
      await this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName);
    const afterTrim = buffer.getTextRevision();
    if (lumine.config.get("whitespace.ensureSingleTrailingNewline", { scope }))
      buffer.transact(() => this.ensureSingleTrailingNewline(editor));
    // No checkpoint is retained while asynchronous work may be cancelled.
    // Reentrant user/listener edits must not be absorbed into this save group.
    if (afterTrim === before + 1 && buffer.getTextRevision() === afterTrim + 1)
      buffer.groupLastChanges();
  }
};

// Group matches in original coordinates before changing any text. In
// particular, converting all tabs must produce one independent edit per row.
function lineEditsForMatches(buffer, regex, transform) {
  const ranges = [];
  for (const range of buffer.findAllSync(regex)) {
    const previous = ranges.at(-1);
    if (previous && previous.start.row === range.start.row) previous.end = range.end;
    else ranges.push({ start: range.start, end: range.end });
  }
  return ranges.map((range) => ({ range, text: transform(buffer.getTextInRange(range)) }));
}
