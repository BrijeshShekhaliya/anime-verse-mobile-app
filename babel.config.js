module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo ships inside the expo package.
    presets: [require.resolve('babel-preset-expo', { paths: [require.resolve('expo/package.json')] })],
    // Release builds drop console.log calls (they cost time on every call);
    // warnings and errors stay.
    env: { production: { plugins: [['transform-remove-console', { exclude: ['error', 'warn'] }]] } },
  };
};
