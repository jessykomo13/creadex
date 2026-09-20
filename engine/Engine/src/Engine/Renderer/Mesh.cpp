#include "Mesh.h"

#include <glad/glad.h>

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

} // namespace WEngine
