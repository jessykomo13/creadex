import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// --- Onglets ---
const tabs = document.querySelectorAll(".tab");
tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-image").style.display = tab.dataset.tab === "image" ? "block" : "none";
    document.getElementById("tab-text").style.display = tab.dataset.tab === "text" ? "block" : "none";
  });
});

// --- Upload image ---
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const preview = document.getElementById("preview");
let selectedFile = null;

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
  selectedFile = file;
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" alt="apercu" />`;
}

// --- Statut ---
const statusEl = document.getElementById("status");
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status " + type;
}

// --- Viewer Three.js ---
const viewerEl = document.getElementById("viewer");
const placeholderEl = document.getElementById("viewerPlaceholder");
let renderer, scene, camera, controls, currentModel;

function initViewer() {
  if (renderer) return;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, viewerEl.clientWidth / viewerEl.clientHeight, 0.01, 1000);
  camera.position.set(2, 1.5, 2);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  viewerEl.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(3, 5, 2);
  scene.add(dirLight);

  window.addEventListener("resize", () => {
    camera.aspect = viewerEl.clientWidth / viewerEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewerEl.clientWidth, viewerEl.clientHeight);
  });

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function loadModel(url) {
  initViewer();
  placeholderEl.style.display = "none";

  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  const loader = new GLTFLoader();
  loader.load(
    url,
    (gltf) => {
      currentModel = gltf.scene;

      const box = new THREE.Box3().setFromObject(currentModel);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const center = box.getCenter(new THREE.Vector3());
      currentModel.position.sub(center);
      currentModel.scale.setScalar(1.5 / size);

      scene.add(currentModel);
      setStatus("Modèle 3D chargé ✔", "ok");
    },
    undefined,
    (err) => setStatus("Erreur de chargement du modèle : " + err.message, "error")
  );
}

// --- Appel API + polling ---
async function pollJob(jobId) {
  setStatus("Génération en cours… (cela peut prendre 30s à quelques minutes)");
  const start = Date.now();
  while (Date.now() - start < 10 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`/api/status/${jobId}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.status === "succeeded") return data.modelUrl;
    if (data.status === "failed") throw new Error(data.error || "La génération a échoué.");
    setStatus(`Génération en cours… (${data.status}${data.progress ? " " + data.progress + "%" : ""})`);
  }
  throw new Error("Délai dépassé.");
}

function showDownload(url) {
  const dl = document.getElementById("download");
  const link = document.getElementById("downloadLink");
  link.href = url;
  dl.style.display = "block";
}

async function generateFromImage() {
  if (!selectedFile) return setStatus("Choisis d'abord une image.", "error");
  const btn = document.getElementById("btnImage");
  btn.disabled = true;
  try {
    const form = new FormData();
    form.append("image", selectedFile);
    setStatus("Envoi de l'image…");
    const res = await fetch("/api/generate/image", { method: "POST", body: form });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const modelUrl = await pollJob(data.jobId);
    loadModel(modelUrl);
    showDownload(modelUrl);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function generateFromText() {
  const prompt = document.getElementById("promptInput").value.trim();
  if (!prompt) return setStatus("Écris une description.", "error");
  const btn = document.getElementById("btnText");
  btn.disabled = true;
  try {
    setStatus("Envoi de la description…");
    const res = await fetch("/api/generate/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const modelUrl = await pollJob(data.jobId);
    loadModel(modelUrl);
    showDownload(modelUrl);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("btnImage").addEventListener("click", generateFromImage);
document.getElementById("btnText").addEventListener("click", generateFromText);
