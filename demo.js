// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [],
  viewport: { width: 1100, height: 340 },
  async before() {},
  async prepare(context) {
    const { state, open } = context;
    state.editor = await open("usage/signal.js");
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Convert tab indentation to spaces.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          state.editor.selectAll();
          lumine.commands.dispatch(
            lumine.views.getView(state.editor),
            "whitespace:convert-all-tabs-to-spaces",
          );
        }
      },
      ready(context) {
        const { state } = context;
        return Boolean(!state.editor.getText().includes("\t"));
      },
    },
  ],
  async cleanup() {},
};
