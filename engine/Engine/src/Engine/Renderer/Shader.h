#pragma once

#include <string>
#include <unordered_map>

namespace WEngine {

    class Shader {
    public:
        Shader(const std::string& vertexSrc, const std::string& fragmentSrc);
        ~Shader();

        Shader(const Shader&) = delete;
        Shader& operator=(const Shader&) = delete;

        void Bind() const;
        void Unbind() const;

        void SetInt(const std::string& name, int value);
        void SetFloat4(const std::string& name, float v0, float v1, float v2, float v3);
        void SetMat4(const std::string& name, const float* matrix);
        void SetFloat3(const std::string& name, float v0, float v1, float v2);
        void SetFloat(const std::string& name, float value);

        // Version rapide pour le rendu : on recupere l'emplacement une seule
        // fois (il ne change jamais pour un programme donne) au lieu de
        // construire une std::string a chaque appel, a chaque frame.
        int GetUniformLocation(const std::string& name);
        void SetInt(int location, int value);
        void SetMat4(int location, const float* matrix);
        void SetFloat3(int location, float v0, float v1, float v2);

    private:
        unsigned int m_RendererID = 0;
        std::unordered_map<std::string, int> m_UniformLocationCache;
    };

} // namespace WEngine
