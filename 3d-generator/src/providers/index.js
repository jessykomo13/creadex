const replicate = require("./replicate");
const meshy = require("./meshy");

const providers = { replicate, meshy };

function getProvider(name) {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Provider "${name}" inconnu. Providers disponibles : ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

module.exports = { getProvider };
