// Adaptateur pour l'API officielle Meshy.ai (https://docs.meshy.ai)

const fetch = require("node-fetch");

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

module.exports = {
  name: "meshy",

  async createImageTo3DJob({ apiKey, config, imageUrl }) {
    const base = config.MESHY_API_BASE || "https://api.meshy.ai";
    const res = await fetch(`${base}/openapi/v1/image-to-3d`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ image_url: imageUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Meshy error: ${data.message || res.statusText}`);
    return data.result;
  },

  async createTextTo3DJob({ apiKey, config, prompt }) {
    const base = config.MESHY_API_BASE || "https://api.meshy.ai";
    const res = await fetch(`${base}/openapi/v2/text-to-3d`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ mode: "preview", prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Meshy error: ${data.message || res.statusText}`);
    return data.result;
  },

  async getJobStatus({ apiKey, jobId, config }) {
    const base = config.MESHY_API_BASE || "https://api.meshy.ai";
    const res = await fetch(`${base}/openapi/v2/text-to-3d/${jobId}`, {
      headers: headers(apiKey),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Meshy error: ${data.message || res.statusText}`);
    if (data.status === "SUCCEEDED") {
      return { status: "succeeded", modelUrl: data.model_urls && data.model_urls.glb };
    }
    if (data.status === "FAILED") {
      return { status: "failed", error: data.task_error || "Job echoue" };
    }
    return { status: "processing", progress: data.progress };
  },
};
