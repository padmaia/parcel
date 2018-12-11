module.exports = () => ({
  presets: [
    [
      require('@babel/preset-env'),
      {
        targets: {
          node: 8
        }
      }
    ],
    require('@babel/preset-flow')
  ]
});
