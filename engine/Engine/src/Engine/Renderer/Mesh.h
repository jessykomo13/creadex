#pragma once

#include <vector>
#include <cstdint>
#include <string>

namespace WEngine {

    // Vertex : position (3) + normale (3, pour l'eclairage) + UV (2, pour les
    // textures) + couleur de base (3, utilisee quand il n'y a pas de texture).
    struct Vertex {
        float px, py, pz;
        float nx, ny, nz;
        float u, v;
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
        static Mesh* CreateSphere(int rings = 16, int sectors = 24);
        static Mesh* CreateCylinder(int sectors = 24);
        // Anneau en fil de fer (rayon 1, dans le plan XZ) : gizmo de rotation.
        static Mesh* CreateRing(int segments = 48);

        // Charge un modele .obj (export standard de Blender). Le modele est
        // recentre et mis a l'echelle pour tenir dans une boite de 1 unite,
        // comme les primitives, pour que l'Echelle de l'Inspecteur se
        // comporte pareil. Renvoie nullptr si le fichier est illisible.
        static Mesh* LoadOBJ(const std::string& path);

    private:
        unsigned int m_VAO = 0, m_VBO = 0, m_EBO = 0;
        uint32_t m_IndexCount = 0;
        bool m_IsLines = false;

    public:
        void SetDrawAsLines(bool value) { m_IsLines = value; }
    };

} // namespace WEngine
