#pragma once

#include <vector>
#include <cstdint>

namespace WEngine {

    // Vertex simple : position (3) + couleur (3). Suffisant pour visualiser
    // des volumes dans l'espace 3D sans texture.
    struct Vertex {
        float px, py, pz;
        float r, g, b;
    };

    class Mesh {
    public:
        Mesh(const std::vector<Vertex>& vertices, const std::vector<uint32_t>& indices);
        ~Mesh();

        Mesh(const Mesh&) = delete;
        Mesh& operator=(const Mesh&) = delete;

        void Draw() const;

        static Mesh* CreateCube();
        static Mesh* CreateGrid(int halfSize, float spacing);

    private:
        unsigned int m_VAO = 0, m_VBO = 0, m_EBO = 0;
        uint32_t m_IndexCount = 0;
        bool m_IsLines = false;

    public:
        void SetDrawAsLines(bool value) { m_IsLines = value; }
    };

} // namespace WEngine
