// Release builds print nothing. Under `expo start` every log works as usual. Imported first
// in the root layout, so it's in place before anything else runs.
if (!__DEV__) {
  const silent = () => {};
  console.log = silent;
  console.info = silent;
  console.debug = silent;
  console.warn = silent;
  console.error = silent;
}

export {};
