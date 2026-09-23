#include "Mesh.h"
#include "../Core/Log.h"

#include <glad/glad.h>
#include <cmath>
#include <fstream>
#include <sstream>
#include <array>
#include <cstdlib>

namespace WEngine {

    Mesh::Mesh(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices) {
        m_IndexCount = (uint32_t)indices.size();

        glGenVertexArrays(1, &m_VAO);
        glGenBuffers(1, &m_VBO);
        glGenBuffers(1, &m_EBO);

        glBindVertexArray(m_VAO);

        glBindBuffer(GL_ARRAY_BUFFER, m_VBO);
        glBufferData(GL_ARRAY_BUFFER, vertices.size() * sizeof(Vertex), vertices.data(), GL_STATIC_DRAW);

        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_EBO);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, indices.size() * sizeof(uint32_t), indices.data(), GL_STATIC_DRAW);

        glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, px));
        glEnableVertexAttribArray(0);
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, nx));
        glEnableVertexAttribArray(1);
        glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, u));
        glEnableVertexAttribArray(2);
        glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, r));
        glEnableVertexAttribArray(3);

        glBindVertexArray(0);
    }

    Mesh::~Mesh() {
        glDeleteBuffers(1, &m_EBO);
        glDeleteBuffers(1, &m_VBO);
        glDeleteVertexArrays(1, &m_VAO);
    }

    void Mesh::Draw() const {
        glBindVertexArray(m_VAO);
        glDrawElements(m_IsLines ? GL_LINES : GL_TRIANGLES, (GLsizei)m_IndexCount, GL_UNSIGNED_INT, nullptr);
        glBindVertexArray(0);
    }

    // Couleur de base neutre (blanc casse) sur toutes les primitives : la
    // couleur finale d'un objet vient entierement de son "tint" (Inspecteur),
    // comme dans un vrai editeur, plutot que d'un degrade fige par face.
    static constexpr float BASE_COL = 0.92f;

    Mesh* Mesh::CreateCube() {
        struct Face { float nx, ny, nz; float verts[4][3]; };
        Face faces[6] = {
            { 0, 0,-1, { {-0.5f,-0.5f,-0.5f}, { 0.5f,-0.5f,-0.5f}, { 0.5f, 0.5f,-0.5f}, {-0.5f, 0.5f,-0.5f} } },
            { 0, 0, 1, { {-0.5f,-0.5f, 0.5f}, { 0.5f,-0.5f, 0.5f}, { 0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f} } },
            {-1, 0, 0, { {-0.5f,-0.5f,-0.5f}, {-0.5f, 0.5f,-0.5f}, {-0.5f, 0.5f, 0.5f}, {-0.5f,-0.5f, 0.5f} } },
            { 1, 0, 0, { { 0.5f,-0.5f,-0.5f}, { 0.5f, 0.5f,-0.5f}, { 0.5f, 0.5f, 0.5f}, { 0.5f,-0.5f, 0.5f} } },
            { 0,-1, 0, { {-0.5f,-0.5f,-0.5f}, { 0.5f,-0.5f,-0.5f}, { 0.5f,-0.5f, 0.5f}, {-0.5f,-0.5f, 0.5f} } },
            { 0, 1, 0, { {-0.5f, 0.5f,-0.5f}, { 0.5f, 0.5f,-0.5f}, { 0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f} } },
        };
        static const float faceUV[4][2] = { {0,0}, {1,0}, {1,1}, {0,1} };

        std::vector<Vertex> v;
        std::vector<uint32_t> idx;
        for (auto& f : faces) {
            uint32_t base = (uint32_t)v.size();
            for (int i = 0; i < 4; i++) {
                v.push_back({ f.verts[i][0], f.verts[i][1], f.verts[i][2],
                               f.nx, f.ny, f.nz,
                               faceUV[i][0], faceUV[i][1],
                               BASE_COL, BASE_COL, BASE_COL });
            }
            idx.push_back(base + 0); idx.push_back(base + 1); idx.push_back(base + 2);
            idx.push_back(base + 2); idx.push_back(base + 3); idx.push_back(base + 0);
        }
        return new Mesh(v, idx);
    }

    Mesh* Mesh::CreateGrid(int halfSize, float spacing) {
        std::vector<Vertex> v;
        std::vector<uint32_t> idx;
        float col = 0.28f;
        for (int i = -halfSize; i <= halfSize; i++) {
            float p = i * spacing, edge = halfSize * spacing;
            uint32_t a = (uint32_t)v.size(); v.push_back({ p, 0.0f, -edge, 0,1,0, 0,0, col,col,col });
            uint32_t b = (uint32_t)v.size(); v.push_back({ p, 0.0f,  edge, 0,1,0, 0,0, col,col,col });
            idx.push_back(a); idx.push_back(b);

            uint32_t c = (uint32_t)v.size(); v.push_back({ -edge, 0.0f, p, 0,1,0, 0,0, col,col,col });
            uint32_t d = (uint32_t)v.size(); v.push_back({  edge, 0.0f, p, 0,1,0, 0,0, col,col,col });
            idx.push_back(c); idx.push_back(d);
        }
        Mesh* mesh = new Mesh(v, idx);
        mesh->SetDrawAsLines(true);
        return mesh;
    }

    // Sphere UV, rayon 0.5 (meme boite englobante unitaire que le cube).
    Mesh* Mesh::CreateSphere(int rings, int sectors) {
        std::vector<Vertex> v;
        std::vector<uint32_t> idx;
        const float radius = 0.5f;
        const float PI = 3.14159265f;

        for (int ring = 0; ring <= rings; ring++) {
            float theta = PI * (float)ring / (float)rings;
            float y = std::cos(theta) * radius;
            float ringRadius = std::sin(theta) * radius;
            for (int sector = 0; sector <= sectors; sector++) {
                float phi = 2.0f * PI * (float)sector / (float)sectors;
                float x = ringRadius * std::cos(phi);
                float z = ringRadius * std::sin(phi);
                float nx = x / radius, ny = y / radius, nz = z / radius;
                float u = (float)sector / (float)sectors, uvY = (float)ring / (float)rings;
                v.push_back({ x, y, z, nx, ny, nz, u, uvY, BASE_COL, BASE_COL, BASE_COL });
            }
        }
        for (int ring = 0; ring < rings; ring++) {
            for (int sector = 0; sector < sectors; sector++) {
                uint32_t a = ring * (sectors + 1) + sector;
                uint32_t b = a + sectors + 1;
                idx.push_back(a); idx.push_back(b); idx.push_back(a + 1);
                idx.push_back(a + 1); idx.push_back(b); idx.push_back(b + 1);
            }
        }
        return new Mesh(v, idx);
    }

    // Cylindre plein (deux capuchons), rayon 0.5, hauteur 1 : meme boite
    // englobante unitaire que le cube pour que l'echelle se comporte pareil.
    Mesh* Mesh::CreateCylinder(int sectors) {
        std::vector<Vertex> v;
        std::vector<uint32_t> idx;
        const float radius = 0.5f, halfHeight = 0.5f;
        const float PI = 3.14159265f;

        uint32_t topCenter = (uint32_t)v.size();
        v.push_back({ 0.0f, halfHeight, 0.0f, 0,1,0, 0.5f,0.5f, BASE_COL,BASE_COL,BASE_COL });
        uint32_t bottomCenter = (uint32_t)v.size();
        v.push_back({ 0.0f, -halfHeight, 0.0f, 0,-1,0, 0.5f,0.5f, BASE_COL,BASE_COL,BASE_COL });

        uint32_t topRingStart = (uint32_t)v.size();
        for (int i = 0; i <= sectors; i++) {
            float phi = 2.0f * PI * (float)i / (float)sectors;
            float x = radius * std::cos(phi), z = radius * std::sin(phi);
            v.push_back({ x, halfHeight, z, 0,1,0, x + 0.5f, z + 0.5f, BASE_COL,BASE_COL,BASE_COL });
        }
        uint32_t bottomRingStart = (uint32_t)v.size();
        for (int i = 0; i <= sectors; i++) {
            float phi = 2.0f * PI * (float)i / (float)sectors;
            float x = radius * std::cos(phi), z = radius * std::sin(phi);
            v.push_back({ x, -halfHeight, z, 0,-1,0, x + 0.5f, z + 0.5f, BASE_COL,BASE_COL,BASE_COL });
        }

        uint32_t sideStart = (uint32_t)v.size();
        for (int i = 0; i <= sectors; i++) {
            float phi = 2.0f * PI * (float)i / (float)sectors;
            float x = radius * std::cos(phi), z = radius * std::sin(phi);
            float u = (float)i / (float)sectors;
            float nx = x / radius, nz = z / radius;
            v.push_back({ x, halfHeight, z, nx, 0.0f, nz, u, 1.0f, BASE_COL,BASE_COL,BASE_COL });
            v.push_back({ x, -halfHeight, z, nx, 0.0f, nz, u, 0.0f, BASE_COL,BASE_COL,BASE_COL });
        }

        for (int i = 0; i < sectors; i++) {
            idx.push_back(topCenter); idx.push_back(topRingStart + i); idx.push_back(topRingStart + i + 1);
            idx.push_back(bottomCenter); idx.push_back(bottomRingStart + i + 1); idx.push_back(bottomRingStart + i);

            uint32_t t0 = sideStart + i * 2, b0 = sideStart + i * 2 + 1;
            uint32_t t1 = sideStart + (i + 1) * 2, b1 = sideStart + (i + 1) * 2 + 1;
            idx.push_back(t0); idx.push_back(b0); idx.push_back(t1);
            idx.push_back(t1); idx.push_back(b0); idx.push_back(b1);
        }
        return new Mesh(v, idx);
    }

    Mesh* Mesh::CreateRing(int segments) {
        std::vector<Vertex> v;
        std::vector<uint32_t> idx;
        const float PI = 3.14159265f;
        for (int i = 0; i < segments; i++) {
            float a = 2.0f * PI * (float)i / (float)segments;
            v.push_back({ std::cos(a), 0.0f, std::sin(a), 0,1,0, 0,0, BASE_COL, BASE_COL, BASE_COL });
        }
        for (int i = 0; i < segments; i++) {
            idx.push_back((uint32_t)i);
            idx.push_back((uint32_t)((i + 1) % segments));
        }
        Mesh* mesh = new Mesh(v, idx);
        mesh->SetDrawAsLines(true);
        return mesh;
    }

    // ---- Import .obj (Blender : Fichier > Exporter > Wavefront (.obj)) ----

    // "12", "12/4", "12//7" ou "12/4/7" -> indices (1-based, negatifs = depuis la fin)
    static void ParseOBJFaceRef(const std::string& token, int posCount, int uvCount, int normCount,
                                int& outPos, int& outUV, int& outNorm) {
        outPos = outUV = outNorm = -1;
        int part = 0;
        std::string cur;
        auto flush = [&]() {
            if (!cur.empty()) {
                int value = std::atoi(cur.c_str());
                int resolved = -1;
                if (part == 0) resolved = value > 0 ? value - 1 : posCount + value;
                else if (part == 1) resolved = value > 0 ? value - 1 : uvCount + value;
                else resolved = value > 0 ? value - 1 : normCount + value;
                if (part == 0) outPos = resolved;
                else if (part == 1) outUV = resolved;
                else outNorm = resolved;
            }
            cur.clear();
            part++;
        };
        for (char c : token) {
            if (c == '/') flush();
            else cur += c;
        }
        flush();
    }

    Mesh* Mesh::LoadOBJ(const std::string& path) {
        std::ifstream file(path);
        if (!file) {
            WE_WARN("Modele introuvable ou illisible : ", path);
            return nullptr;
        }

        std::vector<std::array<float, 3>> positions;
        std::vector<std::array<float, 3>> normals;
        std::vector<std::array<float, 2>> uvs;
        std::vector<Vertex> verts;
        std::vector<uint32_t> idx;

        std::string line;
        while (std::getline(file, line)) {
            if (line.empty() || line[0] == '#') continue;
            std::istringstream ss(line);
            std::string tag;
            ss >> tag;

            if (tag == "v") {
                std::array<float, 3> p{ 0, 0, 0 };
                ss >> p[0] >> p[1] >> p[2];
                positions.push_back(p);
            } else if (tag == "vn") {
                std::array<float, 3> n{ 0, 1, 0 };
                ss >> n[0] >> n[1] >> n[2];
                normals.push_back(n);
            } else if (tag == "vt") {
                std::array<float, 2> t{ 0, 0 };
                ss >> t[0] >> t[1];
                uvs.push_back(t);
            } else if (tag == "f") {
                std::vector<uint32_t> faceVerts;
                std::string token;
                while (ss >> token) {
                    int pi, ti, ni;
                    ParseOBJFaceRef(token, (int)positions.size(), (int)uvs.size(), (int)normals.size(), pi, ti, ni);
                    if (pi < 0 || pi >= (int)positions.size()) continue;

                    Vertex v{};
                    v.px = positions[pi][0]; v.py = positions[pi][1]; v.pz = positions[pi][2];
                    if (ni >= 0 && ni < (int)normals.size()) {
                        v.nx = normals[ni][0]; v.ny = normals[ni][1]; v.nz = normals[ni][2];
                    } else {
                        v.nx = 0.0f; v.ny = 1.0f; v.nz = 0.0f; // corrigee plus bas si absente
                    }
                    if (ti >= 0 && ti < (int)uvs.size()) {
                        v.u = uvs[ti][0]; v.v = uvs[ti][1];
                    } else {
                        v.u = 0.0f; v.v = 0.0f;
                    }
                    v.r = BASE_COL; v.g = BASE_COL; v.b = BASE_COL;

                    faceVerts.push_back((uint32_t)verts.size());
                    verts.push_back(v);
                }
                // Triangulation en eventail (gere les quads et n-gones de Blender)
                for (size_t i = 2; i < faceVerts.size(); i++) {
                    idx.push_back(faceVerts[0]);
                    idx.push_back(faceVerts[i - 1]);
                    idx.push_back(faceVerts[i]);
                }
            }
        }

        if (verts.empty() || idx.empty()) {
            WE_WARN("Modele vide ou non supporte : ", path);
            return nullptr;
        }

        // Normales manquantes : on les calcule par face.
        if (normals.empty()) {
            for (size_t i = 0; i + 2 < idx.size(); i += 3) {
                Vertex& a = verts[idx[i]];
                Vertex& b = verts[idx[i + 1]];
                Vertex& c = verts[idx[i + 2]];
                float ux = b.px - a.px, uy = b.py - a.py, uz = b.pz - a.pz;
                float vx = c.px - a.px, vy = c.py - a.py, vz = c.pz - a.pz;
                float nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                float len = std::sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 1e-8f) { nx /= len; ny /= len; nz /= len; }
                a.nx = nx; a.ny = ny; a.nz = nz;
                b.nx = nx; b.ny = ny; b.nz = nz;
                c.nx = nx; c.ny = ny; c.nz = nz;
            }
        }

        // Recentre et met a l'echelle pour tenir dans une boite de 1 unite.
        float minX = verts[0].px, maxX = minX, minY = verts[0].py, maxY = minY, minZ = verts[0].pz, maxZ = minZ;
        for (const Vertex& v : verts) {
            minX = std::fmin(minX, v.px); maxX = std::fmax(maxX, v.px);
            minY = std::fmin(minY, v.py); maxY = std::fmax(maxY, v.py);
            minZ = std::fmin(minZ, v.pz); maxZ = std::fmax(maxZ, v.pz);
        }
        float cx = (minX + maxX) * 0.5f, cy = (minY + maxY) * 0.5f, cz = (minZ + maxZ) * 0.5f;
        float extent = std::fmax(maxX - minX, std::fmax(maxY - minY, maxZ - minZ));
        float scale = (extent > 1e-6f) ? (1.0f / extent) : 1.0f;
        for (Vertex& v : verts) {
            v.px = (v.px - cx) * scale;
            v.py = (v.py - cy) * scale;
            v.pz = (v.pz - cz) * scale;
        }

        WE_INFO("Modele charge : ", path, " (", verts.size(), " sommets, ", idx.size() / 3, " triangles)");
        return new Mesh(verts, idx);
    }

} // namespace WEngine
