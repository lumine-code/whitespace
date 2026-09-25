const Whitespace = require("./whitespace");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "whitespace",
      tips: [
        "Lumine strips trailing whitespace and adds a final newline on save, and both can be turned off per language.",
      ],
    };
  },

  activate() {
    this.whitespace = new Whitespace();
  },

  deactivate() {
    if (this.whitespace) this.whitespace.destroy();
    this.whitespace = null;
  },
};
