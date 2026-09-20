#include "Mesh.h"

#include <glad/glad.h>
#include <cmath>

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
        glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex), (void*)offsetof(Vertex, r));
        glEnableVertexAttribArray(1);

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

    Mesh* Mesh::CreateCube() {
        std::vector<Vertex> v = {
            {-0.5f,-0.5f,-0.5f, 0.85f,0.35f,0.35f}, { 0.5f,-0.5f,-0.5f, 0.85f,0.35f,0.35f},
            { 0.5f, 0.5f,-0.5f, 0.85f,0.35f,0.35f}, {-0.5f, 0.5f,-0.5f, 0.85f,0.35f,0.35f},
            {-0.5f,-0.5f, 0.5f, 0.35f,0.65f,0.9f }, { 0.5f,-0.5f, 0.5f, 0.35f,0.65f,0.9f },
            { 0.5f, 0.5f, 0.5f, 0.35f,0.65f,0.9f }, {-0.5f, 0.5f, 0.5f, 0.35f,0.65f,0.9f },
            {-0.5f,-0.5f,-0.5f, 0.4f,0.85f,0.55f}, {-0.5f, 0.5f,-0.5f, 0.4f,0.85f,0.55f},
            {-0.5f, 0.5f, 0.5f, 0.4f,0.85f,0.55f}, {-0.5f,-0.5f, 0.5f, 0.4f,0.85f,0.55f},
            { 0.5f,-0.5f,-0.5f, 0.95f,0.75f,0.25f}, { 0.5f, 0.5f,-0.5f, 0.95f,0.75f,0.25f},
            { 0.5f, 0.5f, 0.5f, 0.95f,0.75f,0.25f}, { 0.5f,-0.5f, 0.5f, 0.95f,0.75f,0.25f},
            {-0.5f,-0.5f,-0.5f, 0.7f,0.5f,0.9f  }, { 0.5f,-0.5f,-0.5f, 0.7f,0.5f,0.9f  },
            { 0.5f,-0.5f, 0.5f, 0.7f,0.5f,0.9f  }, {-0.5f,-0.5f, 0.5f, 0.7f,0.5f,0.9f  },
            {-0.5f, 0.5f,-0.5f, 0.9f,0.9f,0.9f  }, { 0.5f, 0.5f,-0.5f, 0.9f,0.9f,0.9f  },
            { 0.5f, 0.5f, 0.5f, 0.9f,0.9f,0.9f  }, {-0.5f, 0.5f, 0.5f, 0.9f,0.9f,0.9f  },
        };
        std::vector<uint32_t> idx;
        for (uint32_t face = 0; face < 6; face++) {
            uint32_t base = face * 4;
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
            uint32_t a = (uint32_t)v.size(); v.push_back({ p, 0.0f, -edge, col,col,col });
            uint32_t b = (uint32_t)v.size(); v.push_back({ p, 0.0f,  edge, col,col,col });
            idx.push_back(a); idx.push_back(b);

            uint32_t c = (uint32_t)v.size(); v.push_back({ -edge, 0.0f, p, col,col,col });
            uint32_t d = (uint32_t)v.size(); v.push_back({  edge, 0.0f, p, col,col,col });
            idx.push_back(c); idx.push_back(d);
        }
        Mesh* mesh = new Mesh(v, idx);
        mesh->SetDrawAsLines(true);
        return mesh;
    }

    // Sphere UV, rayon 0.5 (meme boite englobante unitaire que le cube),
    // couleur de base neutre pour laisser le tint de l'objet dominer.
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
                v.push_back({ x, y, z, 0.9f, 0.9f, 0.9f });
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
        const float col = 0.9f;
        const float PI = 3.14159265f;

        uint32_t topCenter = (uint32_t)v.size();
        v.push_back({ 0.0f, halfHeight, 0.0f, col, col, col });
        uint32_t bottomCenter = (uint32_t)v.size();
        v.push_back({ 0.0f, -halfHeight, 0.0f, col, col, col });

        uint32_t topRingStart = (uint32_t)v.size();
        for (int i = 0; i <= sectors; i++) {
            float phi = 2.0f * PI * (float)i / (float)sectors;
            v.push_back({ radius * std::cos(phi), halfHeight, radius * std::sin(phi), col, col, col });
        }
        uint32_t bottomRingStart = (uint32_t)v.size();
        for (int i = 0; i <= sectors; i++) {
            float phi = 2.0f * PI * (float)i / (float)sectors;
            v.push_back({ radius * std::cos(phi), -halfHeight, radius * std::sin(phi), col, col, col });
        }

        for (int i = 0; i < sectors; i++) {
            idx.push_back(topCenter); idx.push_back(topRingStart + i); idx.push_back(topRingStart + i + 1);
            idx.push_back(bottomCenter); idx.push_back(bottomRingStart + i + 1); idx.push_back(bottomRingStart + i);

            uint32_t t0 = topRingStart + i, t1 = topRingStart + i + 1;
            uint32_t b0 = bottomRingStart + i, b1 = bottomRingStart + i + 1;
            idx.push_back(t0); idx.push_back(b0); idx.push_back(t1);
            idx.push_back(t1); idx.push_back(b0); idx.push_back(b1);
        }
        return new Mesh(v, idx);
    }

} // namespace WEngine
