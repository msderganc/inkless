import "fake-indexeddb/auto";

// NiimBlueLib logs a warning for every optional query the recorded printer does not answer.
// Keep test output readable; set DEBUG_TESTS=1 to see them. (Assigned, not spied, so that
// vi.restoreAllMocks() in tests does not bring them back.)
if (!process.env.DEBUG_TESTS) {
  const quiet = () => undefined;
  console.warn = quiet;
  console.error = quiet;
  console.log = quiet;
  console.info = quiet;
}
