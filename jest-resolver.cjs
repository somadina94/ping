/** Resolve TypeScript source when imports use NodeNext `*.js` specifiers. */
module.exports = (request, options) => {
  const resolve = options.defaultResolver;
  try {
    return resolve(request, options);
  } catch (err) {
    if (typeof request === "string" && request.endsWith(".js")) {
      return resolve(request.slice(0, -3) + ".ts", options);
    }
    throw err;
  }
};
