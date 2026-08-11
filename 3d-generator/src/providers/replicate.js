// Adaptateur pour l'API Replicate (https://replicate.com/docs/reference/http)
// Fonctionne avec n'importe quel modele Replicate "image -> 3D" ou "texte -> 3D"
// qui prend en entree {image} ou {prompt} et renvoie un fichier .glb/.obj en sortie.

const fetch = require("node-fetch");

const API_BASE = "https://api.replicate.com/v1";

function headers(apiKey) {
  return {
    Authorization: `Token ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function createPrediction({ apiKey, version, input }) {
  const res = await fetch(`${API_BASE}/predictions`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ version, input }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Replicate error: ${data.detail || res.statusText}`);
  }
  return data.id;
}

async function getPrediction({ apiKey, id }) {
  const res = await fetch(`${API_BASE}/predictions/${id}`, {
    headers: headers(apiKey),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Replicate error: ${data.detail || res.statusText}`);
  }
  return data;
}

function extractModelUrl(output) {
  // La forme de "output" varie selon le modele : string, tableau, ou objet.
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.find((v) => typeof v === "string" && /\.(glb|gltf|obj)(\?|$)/i.test(v)) || output[0];
  }
  if (typeof output === "object") {
    return output.model_file || output.mesh || output.glb || output.output || null;
  }
  return null;
}

module.exports = {
  name: "replicate",

  async createImageTo3DJob({ apiKey, config, imageUrl }) {
    if (!config.REPLICATE_IMAGE_TO_3D_VERSION) {
      throw new Error("REPLICATE_IMAGE_TO_3D_VERSION manquant dans .env");
    }
    const id = await createPrediction({
      apiKey,
      version: config.REPLICATE_IMAGE_TO_3D_VERSION,
      input: { image: imageUrl },
    });
    return id;
  },

  async createTextTo3DJob({ apiKey, config, prompt }) {
    if (!config.REPLICATE_TEXT_TO_3D_VERSION) {
      throw new Error("REPLICATE_TEXT_TO_3D_VERSION manquant dans .env");
    }
    const id = await createPrediction({
      apiKey,
      version: config.REPLICATE_TEXT_TO_3D_VERSION,
      input: { prompt },
    });
    return id;
  },

  async getJobStatus({ apiKey, jobId }) {
    const data = await getPrediction({ apiKey, id: jobId });
    if (data.status === "succeeded") {
      return { status: "succeeded", modelUrl: extractModelUrl(data.output) };
    }
    if (data.status === "failed" || data.status === "canceled") {
      return { status: "failed", error: data.error || "Job echoue" };
    }
    return { status: "processing" };
  },
};
