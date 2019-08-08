let date = process.env.BABEL_BUILD_DATE;

module.exports = {
  "plugins": [["babel-plugin-dummy", {date}]]
}
