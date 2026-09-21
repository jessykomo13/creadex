#include "Shader.h"
#include "../Core/Log.h"

#include <glad/glad.h>
#include <vector>

namespace WEngine {

    static unsigned int CompileShader(unsigned int type, const std::string& source) {
        unsigned int shader = glCreateShader(type);
        const char* src = source.c_str();
        glShaderSource(shader, 1, &src, nullptr);
        glCompileShader(shader);

        int success;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
        if (!success) {
            int length;
            glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &length);
            std::vector<char> message(length);
            glGetShaderInfoLog(shader, length, &length, message.data());
            WE_ERROR("Shader compilation failed: ", message.data());
            glDeleteShader(shader);
            return 0;
        }

        return shader;
    }

    Shader::Shader(const std::string& vertexSrc, const std::string& fragmentSrc) {
        unsigned int vs = CompileShader(GL_VERTEX_SHADER, vertexSrc);
        unsigned int fs = CompileShader(GL_FRAGMENT_SHADER, fragmentSrc);

        m_RendererID = glCreateProgram();
        glAttachShader(m_RendererID, vs);
        glAttachShader(m_RendererID, fs);
        glLinkProgram(m_RendererID);

        int linked;
        glGetProgramiv(m_RendererID, GL_LINK_STATUS, &linked);
        if (!linked) {
            int length;
            glGetProgramiv(m_RendererID, GL_INFO_LOG_LENGTH, &length);
            std::vector<char> message(length);
            glGetProgramInfoLog(m_RendererID, length, &length, message.data());
            WE_ERROR("Shader linking failed: ", message.data());
        }

        glDeleteShader(vs);
        glDeleteShader(fs);
    }

    Shader::~Shader() {
        glDeleteProgram(m_RendererID);
    }

    void Shader::Bind() const {
        glUseProgram(m_RendererID);
    }

    void Shader::Unbind() const {
        glUseProgram(0);
    }

    int Shader::GetUniformLocation(const std::string& name) {
        auto it = m_UniformLocationCache.find(name);
        if (it != m_UniformLocationCache.end()) return it->second;

        int location = glGetUniformLocation(m_RendererID, name.c_str());
        m_UniformLocationCache[name] = location;
        return location;
    }

    void Shader::SetInt(const std::string& name, int value) {
        glUniform1i(GetUniformLocation(name), value);
    }

    void Shader::SetFloat4(const std::string& name, float v0, float v1, float v2, float v3) {
        glUniform4f(GetUniformLocation(name), v0, v1, v2, v3);
    }

    void Shader::SetFloat3(const std::string& name, float v0, float v1, float v2) {
        glUniform3f(GetUniformLocation(name), v0, v1, v2);
    }

    void Shader::SetFloat(const std::string& name, float value) {
        glUniform1f(GetUniformLocation(name), value);
    }

    void Shader::SetMat4(const std::string& name, const float* matrix) {
        glUniformMatrix4fv(GetUniformLocation(name), 1, GL_FALSE, matrix);
    }

    void Shader::SetInt(int location, int value) {
        glUniform1i(location, value);
    }

    void Shader::SetFloat3(int location, float v0, float v1, float v2) {
        glUniform3f(location, v0, v1, v2);
    }

    void Shader::SetMat4(int location, const float* matrix) {
        glUniformMatrix4fv(location, 1, GL_FALSE, matrix);
    }

} // namespace WEngine
