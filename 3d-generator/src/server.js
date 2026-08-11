require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { getProvider } = require("./providers");

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "..", "public")));

// Stockage en memoire des jobs (redemarrage du serveur = perte des jobs en cours)
const jobs = new Map();

function config() {
  return process.env;
}

function apiKey() {
  const key = process.env.API_KEY;
  if (!key) {
    throw new Error(
      "API_KEY manquante. Copie .env.example en .env et renseigne ta cle API (Replicate, Meshy, ...)."
    );
  }
  return key;
}

app.post("/api/generate/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune image envoyee." });

    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    const provider = getProvider(process.env.PROVIDER || "replicate");

    const providerJobId = await provider.createImageTo3DJob({
      apiKey: apiKey(),
      config: config(),
      imageUrl,
    });

    const jobId = `${provider.name}:${providerJobId}`;
    jobs.set(jobId, { status: "processing", provider: provider.name });
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/generate/text", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Le champ 'prompt' est requis." });
    }

    const provider = getProvider(process.env.PROVIDER || "replicate");
    const providerJobId = await provider.createTextTo3DJob({
      apiKey: apiKey(),
      config: config(),
      prompt: prompt.trim(),
    });

    const jobId = `${provider.name}:${providerJobId}`;
    jobs.set(jobId, { status: "processing", provider: provider.name });
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const [providerName, providerJobId] = jobId.split(":");
    const provider = getProvider(providerName);

    const result = await provider.getJobStatus({
      apiKey: apiKey(),
      config: config(),
      jobId: providerJobId,
    });

    jobs.set(jobId, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Generateur 3D IA lance sur http://localhost:${PORT}`);
  console.log(`Provider actif : ${process.env.PROVIDER || "replicate (defaut)"}`);
});
