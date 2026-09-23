#include "Texture.h"
#include "../Core/Log.h"

#include <glad/glad.h>

#define STB_IMAGE_IMPLEMENTATION
#include <stb_image.h>

namespace WEngine {

    Texture::Texture(const std::string& path) {
        stbi_set_flip_vertically_on_load(1);
        unsigned char* data = stbi_load(path.c_str(), &m_Width, &m_Height, &m_Channels, 0);
        if (!data) {
            WE_WARN("Impossible de charger la texture : ", path);
            return;
        }

        GLenum format = m_Channels == 4 ? GL_RGBA : (m_Channels == 3 ? GL_RGB : GL_RED);

        glGenTextures(1, &m_ID);
        glBindTexture(GL_TEXTURE_2D, m_ID);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexImage2D(GL_TEXTURE_2D, 0, format, m_Width, m_Height, 0, format, GL_UNSIGNED_BYTE, data);
        glGenerateMipmap(GL_TEXTURE_2D);
        glBindTexture(GL_TEXTURE_2D, 0);

        stbi_image_free(data);
    }

    Texture::~Texture() {
        if (m_ID) glDeleteTextures(1, &m_ID);
    }

    void Texture::Bind(unsigned int slot) const {
        glActiveTexture(GL_TEXTURE0 + slot);
        glBindTexture(GL_TEXTURE_2D, m_ID);
    }

} // namespace WEngine
